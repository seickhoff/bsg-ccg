import type {
  GameState,
  GameAction,
  ValidAction,
  CardRegistry,
  CardDef,
  BaseCardDef,
  CardCost,
  PlayerState,
} from "@bsg/shared";
import { getMissionCategory } from "./mission-abilities.js";
import { getEventTargets } from "./event-abilities.js";
import { dispatchAIDecidePendingChoice } from "./pending-choice-registry.js";

// ============================================================
// BSG CCG — AI Decision Engine
// Pure function: given game state + valid actions, returns a GameAction.
// ============================================================

/** Classify the effect an ability has on its target.
 *  Checks what happens to the TARGET — costs like "commit a unit you control" are ignored.
 */
function classifyEffect(abilityText: string): "buff" | "debuff" | "neutral" {
  const text = abilityText.toLowerCase();
  // Check what happens to the "target" specifically — power changes on the target take priority
  // because cost phrases like "commit a unit you control" aren't the effect on the target
  if (/target.*\+\d+\s*power/.test(text) || /target.*gets\s+\+/.test(text)) {
    return "buff";
  }
  if (/target.*\-\d+\s*power/.test(text) || /target.*gets\s+\-/.test(text)) {
    return "debuff";
  }
  // Debuff: harmful to the target
  if (
    text.includes("defeat") ||
    text.includes("commit") ||
    text.includes("exhaust") ||
    text.includes("loses") ||
    text.includes("lose") ||
    text.includes("discard") ||
    text.includes("destroy") ||
    /\-\d+\s*power/.test(text)
  ) {
    return "debuff";
  }
  // Buff: beneficial to the target
  if (
    text.includes("ready") ||
    text.includes("restore") ||
    text.includes("draw") ||
    text.includes("gain") ||
    text.includes("search") ||
    /\+\d+\s*power/.test(text)
  ) {
    return "buff";
  }
  return "neutral";
}

/** Check if a unit instanceId belongs to the given player. */
function isOwnUnit(state: GameState, playerIndex: number, instanceId: string): boolean {
  const player = state.players[playerIndex];
  for (const zone of [player.zones.alert, player.zones.reserve]) {
    for (const stack of zone) {
      if (stack.cards[0]?.instanceId === instanceId) return true;
    }
  }
  return false;
}

/** Compute optimal stack selection (minimize waste) for a given cost. */
function computeOptimalStacksAI(
  player: PlayerState,
  cost: CardCost,
  registry: CardRegistry,
): number[] | undefined {
  if (!cost) return undefined;
  const selected: number[] = [];
  for (const [resType, amount] of Object.entries(cost) as [string, number][]) {
    const candidates = player.zones.resourceStacks
      .map((s, i) => {
        if (s.exhausted) return null;
        const base = registry.bases[s.topCard.defId];
        const resName = base ? base.resource : registry.cards[s.topCard.defId]?.resource;
        if (resName !== resType) return null;
        return { index: i, count: 1 + s.supplyCards.length };
      })
      .filter((c): c is { index: number; count: number } => c !== null)
      .sort((a, b) => a.count - b.count);

    let remaining = amount;
    for (const c of candidates) {
      if (remaining <= 0) break;
      selected.push(c.index);
      remaining -= c.count;
    }
  }
  return selected.length > 0 ? selected : undefined;
}

export function makeAIDecision(
  state: GameState,
  playerIndex: number,
  validActions: ValidAction[],
  registry: CardRegistry,
): GameAction {
  if (validActions.length === 0) {
    return { type: "pass" };
  }

  // If only one option, take it
  if (validActions.length === 1) {
    return resolveAction(validActions[0], state, playerIndex, registry);
  }

  const player = state.players[playerIndex];
  const phase = state.phase;

  // --- Setup: always keep hand ---
  if (phase === "setup") {
    return { type: "keepHand" };
  }

  // --- Ready step 3: draw cards ---
  if (phase === "ready" && state.readyStep === 3) {
    return { type: "drawCards" };
  }

  // --- Ready step 4: play a resource ---
  if (phase === "ready" && state.readyStep === 4) {
    return decideResourcePlay(validActions, state, playerIndex, registry);
  }

  // --- Ready step 5: reorder stacks then done ---
  if (phase === "ready" && state.readyStep === 5) {
    // AI: just accept default order
    return { type: "doneReorder" };
  }

  // --- Pending choice (e.g. Celestra deck manipulation) ---
  if (state.pendingChoice) {
    return decidePendingChoice(validActions, state, playerIndex, registry);
  }

  // --- Triggered ability (Agro Ship / Flattop) ---
  if (state.challenge?.pendingTrigger?.playerIndex === playerIndex) {
    return decideTrigger(validActions, state, playerIndex, registry);
  }

  // --- Challenge: Sniper step A — AI as defender decides accept/decline ---
  if (
    state.challenge?.waitingForDefender &&
    state.challenge.defenderSelector === "challenger" &&
    !state.challenge.sniperDefendAccepted &&
    state.challenge.defenderPlayerIndex === playerIndex
  ) {
    return decideSniperAccept(validActions, state, playerIndex, registry);
  }

  // --- Challenge: Sniper step B — AI as challenger picks opponent's defender ---
  if (
    state.challenge?.waitingForDefender &&
    state.challenge.sniperDefendAccepted &&
    state.challenge.challengerPlayerIndex === playerIndex
  ) {
    return decideSniperDefenderChoice(validActions, state, playerIndex, registry);
  }

  // --- Challenge: defend/decline ---
  if (state.challenge?.waitingForDefender && state.challenge.defenderPlayerIndex === playerIndex) {
    return decideDefend(validActions, state, playerIndex, registry);
  }

  // --- Challenge step 2: play effects ---
  if (state.challenge?.step === 2) {
    return decideChallengeEffects(validActions, state, playerIndex, registry);
  }

  // --- Cylon phase ---
  if (phase === "cylon") {
    return decideCylonPhase(validActions, state, playerIndex, registry);
  }

  // --- Execution phase ---
  if (phase === "execution") {
    return decideExecution(validActions, state, playerIndex, registry);
  }

  // Fallback: first available action
  return resolveAction(validActions[0], state, playerIndex, registry);
}

// --- Ready step 4: play asset/supply/pass ---
function decideResourcePlay(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const player = state.players[playerIndex];
  const baseDef = registry.bases[player.baseDefId];

  const deployAction = actions.find((a) => a.type === "playToResource");
  if (!deployAction?.selectableCardIndices) {
    return { type: "passResource" };
  }

  // Pick the best card to play as a resource (prefer matching base resource, then any resource card)
  let bestCardIdx = -1;
  for (const idx of deployAction.selectableCardIndices) {
    const card = player.hand[idx];
    if (!card) continue;
    const def = registry.cards[card.defId];
    if (def?.resource === baseDef?.resource) {
      bestCardIdx = idx;
      break; // perfect match
    }
    if (def?.resource && bestCardIdx < 0) {
      bestCardIdx = idx;
    }
  }

  // Decide: play as asset (new stack) or supply (grow an existing stack)
  // Target stack sizes per resource type: 1, 2, 4 — binary encoding for efficient spending
  if (bestCardIdx >= 0) {
    const card = player.hand[bestCardIdx];
    const def = card ? registry.cards[card.defId] : null;
    const resType = def?.resource;

    if (resType && deployAction.selectableStackIndices?.length) {
      // Get current stack sizes for this resource type
      const stacksOfType: { index: number; size: number }[] = [];
      for (const stackIdx of deployAction.selectableStackIndices) {
        const stack = player.zones.resourceStacks[stackIdx];
        if (!stack) continue;
        const stackBase = registry.bases[stack.topCard.defId];
        const stackRes = stackBase
          ? stackBase.resource
          : registry.cards[stack.topCard.defId]?.resource;
        if (stackRes === resType) {
          stacksOfType.push({ index: stackIdx, size: 1 + stack.supplyCards.length });
        }
      }

      // Target pattern: [4, 2, 1] — find the first target size we haven't reached
      const targets = [4, 2, 1];
      const sizes = stacksOfType.map((s) => s.size).sort((a, b) => b - a);

      let supplyTarget: { index: number; size: number } | null = null;
      for (const target of targets) {
        // Check if we have a stack at or above this target size
        const hasTarget = sizes.some((s) => s >= target);
        if (!hasTarget) {
          // Find the largest stack below this target to grow
          const candidate = stacksOfType
            .filter((s) => s.size < target)
            .sort((a, b) => b.size - a.size)[0];
          if (candidate) {
            supplyTarget = candidate;
            break;
          }
        }
      }

      if (supplyTarget) {
        return {
          type: "playToResource",
          cardIndex: bestCardIdx,
          asSupply: true,
          targetStackIndex: supplyTarget.index,
        };
      }
    }

    // No supply needed — play as new asset
    return { type: "playToResource", cardIndex: bestCardIdx, asSupply: false };
  }

  // No resource card available — play any card as supply under best stack
  if (deployAction.selectableStackIndices?.length) {
    return {
      type: "playToResource",
      cardIndex: deployAction.selectableCardIndices[0],
      asSupply: true,
      targetStackIndex: deployAction.selectableStackIndices[0],
    };
  }

  return { type: "passResource" };
}

// --- Execution phase: play cards, challenge, or pass ---
function decideExecution(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const player = state.players[playerIndex];

  // Priority 1: Play the best affordable unit
  const playActions = actions.filter((a) => a.type === "playCard");
  if (playActions.length > 0) {
    const bestPlay = pickBestCardToPlay(playActions, state, playerIndex, registry);
    if (bestPlay) return bestPlay;
  }

  // Priority 2: Resolve a mission if possible (skip dangerous or self-harmful missions)
  const missionActions = actions.filter((a) => a.type === "resolveMission");
  for (const missionAction of missionActions) {
    const mDefId = missionAction.cardDefId;
    const mDef = mDefId ? registry.cards[mDefId] : null;
    if (mDef) {
      const effect = classifyMissionEffect(mDef.abilityText);
      if (effect === "neutral" && isNeutralMissionDangerous(mDef.abilityText, player)) {
        continue; // skip — would kill us or leave us too vulnerable
      }
      // Skip harm-target missions if we can only target ourselves
      if (effect === "harm-target" && missionAction.missionTargetIds?.length) {
        const oppIdx = 1 - playerIndex;
        const hasOppTarget = missionAction.missionTargetIds.some((id) =>
          isOpponentUnit(state, oppIdx, id),
        );
        if (!hasOppTarget) continue;
      }
    }
    return resolveAction(missionAction, state, playerIndex, registry);
  }

  // Priority 3: Challenge with our strongest unit (skip if disabled by challenge cost)
  const challengeAction = actions.find((a) => a.type === "challenge" && !a.disabled);
  if (challengeAction?.selectableInstanceIds?.length) {
    const bestChallenger = pickStrongestUnit(
      challengeAction.selectableInstanceIds,
      state,
      playerIndex,
      registry,
    );
    if (bestChallenger) {
      // Only challenge if we have a unit with power >= 2
      const def = registry.cards[bestChallenger.defId];
      if (def && (def.power ?? 0) >= 2) {
        return {
          type: "challenge",
          challengerInstanceId: bestChallenger.instanceId,
          opponentIndex: 1 - playerIndex,
        };
      }
    }
  }

  // Priority 4: Use an ability (base or unit) if beneficial
  const abilityActions = actions.filter((a) => a.type === "playAbility");
  if (abilityActions.length > 0) {
    // Prefer abilities with impactful effects: draw, influence gain, defeat, exhaust opponent
    const bestAbility = pickBestAbilityAction(abilityActions, state, playerIndex, registry);
    if (bestAbility) {
      return resolveAction(bestAbility, state, playerIndex, registry);
    }
  }

  return { type: "pass" };
}

// --- Defend or decline ---
function decideDefend(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  if (!state.challenge) return { type: "defend", defenderInstanceId: null };

  const challengerInstanceId = state.challenge.challengerInstanceId;
  const challengerPlayer = state.players[state.challenge.challengerPlayerIndex];
  const challengerDef = findUnitDef(challengerInstanceId, challengerPlayer, registry);
  const challengerPower = challengerDef?.power ?? 0;

  // Find defenders
  const defendAction = actions.find((a) => a.type === "defend" && a.selectableInstanceIds?.length);
  if (!defendAction?.selectableInstanceIds) {
    return { type: "defend", defenderInstanceId: null };
  }

  // Pick the strongest defender that can reasonably win
  const bestDefender = pickStrongestUnit(
    defendAction.selectableInstanceIds,
    state,
    playerIndex,
    registry,
  );
  if (bestDefender) {
    const defenderDef = registry.cards[bestDefender.defId];
    const defenderPower = defenderDef?.power ?? 0;
    // Defend if we have equal or greater power (mystic values add variance)
    if (defenderPower >= challengerPower - 1) {
      return { type: "defend", defenderInstanceId: bestDefender.instanceId };
    }
  }

  // Decline to defend
  return { type: "defend", defenderInstanceId: null };
}

// --- Sniper step A: AI as defender decides whether to accept defense ---
function decideSniperAccept(
  _actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  if (!state.challenge) return { type: "sniperAccept", accept: false };

  const challengerDef = findUnitDef(
    state.challenge.challengerInstanceId,
    state.players[state.challenge.challengerPlayerIndex],
    registry,
  );
  const challengerPower = challengerDef?.power ?? 0;

  // Check if we have any unit that could reasonably survive
  const myPlayer = state.players[playerIndex];
  let strongestPower = 0;
  for (const stack of myPlayer.zones.alert) {
    const topCard = stack.cards[0];
    if (topCard && topCard.faceUp && !stack.exhausted) {
      const def = registry.cards[topCard.defId];
      if (def && (def.type === "personnel" || def.type === "ship")) {
        const power = def.power ?? 0;
        if (power > strongestPower) strongestPower = power;
      }
    }
  }

  // Accept defense if our strongest unit can compete; otherwise decline
  // (opponent picks our weakest, so decline if even our strongest is outmatched)
  if (strongestPower >= challengerPower - 1) {
    return { type: "sniperAccept", accept: true };
  }
  return { type: "sniperAccept", accept: false };
}

// --- Sniper step B: AI as challenger picks which opponent unit defends ---
function decideSniperDefenderChoice(
  actions: ValidAction[],
  state: GameState,
  _playerIndex: number,
  registry: CardRegistry,
): GameAction {
  if (!state.challenge) return { type: "defend", defenderInstanceId: null };

  // Collect eligible opponent units from valid actions
  const defendActions = actions.filter(
    (a) => a.type === "defend" && a.selectableInstanceIds?.length,
  );

  // Strategy: pick the weakest opponent unit we can likely beat (destroy it)
  const opponentPlayer = state.players[state.challenge.defenderPlayerIndex];
  let weakest: { instanceId: string; power: number } | null = null;

  for (const action of defendActions) {
    for (const instanceId of action.selectableInstanceIds ?? []) {
      const def = findUnitDef(instanceId, opponentPlayer, registry);
      const power = def?.power ?? 0;
      if (!weakest || power < weakest.power) {
        weakest = { instanceId, power };
      }
    }
  }

  // Pick the weakest unit (defender already accepted, must choose one)
  if (weakest) {
    return { type: "defend", defenderInstanceId: weakest.instanceId };
  }

  // Fallback (shouldn't happen — defender accepted means units exist)
  return { type: "defend", defenderInstanceId: null };
}

// --- Challenge effects (step 2): play events or base abilities, or pass ---
function decideChallengeEffects(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const isChallenger = state.challenge?.challengerPlayerIndex === playerIndex;

  // Priority 1: Use a base ability that buffs our unit in the challenge
  const baseAbilityActions = actions.filter(
    (a) => a.type === "playAbility" && a.cardDefId && registry.bases[a.cardDefId],
  );
  if (baseAbilityActions.length > 0) {
    // Prefer abilities that buff our own unit
    const ownUnitId = isChallenger
      ? state.challenge?.challengerInstanceId
      : state.challenge?.defenderInstanceId;
    const buffOwn = baseAbilityActions.find((a) => a.targetInstanceId === ownUnitId);
    if (buffOwn) {
      return resolveAction(buffOwn, state, playerIndex, registry);
    }
    // Only use base abilities that target our own unit (never buff the opponent)
    const oppUnitId = isChallenger
      ? state.challenge?.defenderInstanceId
      : state.challenge?.challengerInstanceId;
    const beneficial = baseAbilityActions.find((a) => {
      // Never target the opponent's unit with a buff
      if (a.targetInstanceId && a.targetInstanceId === oppUnitId) return false;
      if (!a.cardDefId) return false;
      const baseDef = registry.bases[a.cardDefId];
      if (!baseDef) return false;
      const text = baseDef.abilityText.toLowerCase();
      // Skip negative effects (lose influence, etc.) — those should target opponent, not be used blindly
      if (text.includes("loses") || text.includes("lose")) return false;
      return true;
    });
    if (beneficial) {
      return resolveAction(beneficial, state, playerIndex, registry);
    }
    // Don't blindly fire harmful base abilities during challenges
  }

  // Priority 2: Use unit abilities that buff our unit or debuff opponent
  const unitAbilityActions = actions.filter(
    (a) => a.type === "playAbility" && a.cardDefId && !registry.bases[a.cardDefId],
  );
  if (unitAbilityActions.length > 0) {
    const ownUnitId2 = isChallenger
      ? state.challenge?.challengerInstanceId
      : state.challenge?.defenderInstanceId;
    const oppUnitId2 = isChallenger
      ? state.challenge?.defenderInstanceId
      : state.challenge?.challengerInstanceId;

    for (const ua of unitAbilityActions) {
      const uaDefId = ua.cardDefId;
      if (!uaDefId) continue;
      const uaDef = registry.cards[uaDefId];
      if (!uaDef) continue;
      const effect = classifyEffect(uaDef.abilityText);

      // Buff targeting own challenge unit — good
      if (effect === "buff" && ua.targetInstanceId === ownUnitId2) {
        return resolveAction(ua, state, playerIndex, registry);
      }
      // Debuff targeting opponent's challenge unit — good
      if (effect === "debuff" && ua.targetInstanceId === oppUnitId2) {
        return resolveAction(ua, state, playerIndex, registry);
      }
      // Neutral — use it
      if (effect === "neutral") {
        return resolveAction(ua, state, playerIndex, registry);
      }
    }
    // No safe unit ability to use — fall through to events
  }

  // Priority 3: Play events during challenge — score by abilityId
  const eventActions = actions.filter((a) => a.type === "playEventInChallenge");
  if (eventActions.length > 0) {
    const player = state.players[playerIndex];
    let bestEventIdx = -1;
    let bestEventScore = 0;

    for (const ea of eventActions) {
      for (const idx of ea.selectableCardIndices ?? []) {
        const card = player.hand[idx];
        if (!card) continue;
        const def = registry.cards[card.defId];
        if (!def) continue;
        const score = scoreChallengeEvent(
          def,
          isChallenger,
          state.challenge?.isCylonChallenge ?? false,
        );
        if (score > bestEventScore) {
          bestEventScore = score;
          bestEventIdx = idx;
        }
      }
    }

    if (bestEventIdx >= 0 && bestEventScore > 0) {
      const bestCard = player.hand[bestEventIdx];
      const bestDef = bestCard ? registry.cards[bestCard.defId] : null;
      let targetId: string | undefined;
      if (bestDef?.abilityId) {
        const ctx = state.challenge?.isCylonChallenge ? "cylon-challenge" : "challenge";
        targetId = pickEventTarget(bestDef, state, playerIndex, registry, ctx);
        // If the event needs a target but we couldn't find a good one, skip it
        const targets = getEventTargets(bestDef.abilityId, state, playerIndex, ctx);
        if (targets && targets.length > 0 && !targetId) {
          return { type: "challengePass" };
        }
      }
      return {
        type: "playEventInChallenge",
        cardIndex: bestEventIdx,
        targetInstanceId: targetId,
        selectedStackIndices: bestDef?.cost
          ? computeOptimalStacksAI(player, bestDef.cost, registry)
          : undefined,
      };
    }
  }

  return { type: "challengePass" };
}

// --- Pending choice: smart heuristics per choice type ---
function decidePendingChoice(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  _registry: CardRegistry,
): GameAction {
  const choiceActions = actions.filter((a) => a.type === "makeChoice");
  if (choiceActions.length === 0) return { type: "pass" };

  const registeredIdx = dispatchAIDecidePendingChoice(state, choiceActions, playerIndex);
  if (registeredIdx !== null) {
    return { type: "makeChoice", choiceIndex: registeredIdx };
  }

  // Fallback: pick first option
  return { type: "makeChoice", choiceIndex: 0 };
}

/** Check if a unit instanceId belongs to a specific player. */
function isOpponentUnit(state: GameState, oppIdx: number, instanceId: string): boolean {
  const opp = state.players[oppIdx];
  for (const zone of [opp.zones.alert, opp.zones.reserve]) {
    for (const stack of zone) {
      if (stack.cards[0]?.instanceId === instanceId) return true;
    }
  }
  return false;
}

/**
 * Analyze what traits/types the AI's unresolved missions need.
 * Returns a list of trait/type requirements from missions in hand and alert.
 */
function getMissionNeeds(player: PlayerState, registry: CardRegistry): string[] {
  const needs: string[] = [];
  // Check missions in hand
  for (const card of player.hand) {
    const def = registry.cards[card.defId];
    if (def?.type !== "mission" || !def.resolveText) continue;
    const match = def.resolveText.match(/Resolve:\s*(.+)/);
    if (!match) continue;
    const parts = match[1].replace(/\.$/, "").split(/\s+and\s+/);
    for (const part of parts) {
      const m = part.trim().match(/^\d+\s+(.+?)s?$/);
      if (m) needs.push(m[1].toLowerCase());
    }
  }
  // Check missions already in alert (waiting to be resolved)
  for (const stack of player.zones.alert) {
    const top = stack.cards[0];
    if (!top?.faceUp) continue;
    const def = registry.cards[top.defId];
    if (def?.type !== "mission" || !def.resolveText) continue;
    const match = def.resolveText.match(/Resolve:\s*(.+)/);
    if (!match) continue;
    const parts = match[1].replace(/\.$/, "").split(/\s+and\s+/);
    for (const part of parts) {
      const m = part.trim().match(/^\d+\s+(.+?)s?$/);
      if (m) needs.push(m[1].toLowerCase());
    }
  }
  return needs;
}

/**
 * Check if a unit def satisfies any of the mission needs.
 */
function unitSatisfiesMissionNeed(def: CardDef, needs: string[]): boolean {
  for (const need of needs) {
    if (need === "ship" || need === "ships") {
      if (def.type === "ship") return true;
    } else if (need === "personnel") {
      if (def.type === "personnel") return true;
    } else if (need === "unit" || need === "units") {
      if (def.type === "personnel" || def.type === "ship") return true;
    } else if (need.includes("cylon")) {
      if (def.traits?.includes("Cylon")) return true;
    } else if (need.includes("civilian")) {
      if (def.traits?.includes("Civilian")) return true;
    } else {
      // Trait match: "officer" → "Officer", "pilot" → "Pilot", etc.
      const traitName = need.charAt(0).toUpperCase() + need.slice(1).replace(/s$/, "");
      if (def.traits?.some((t) => t === traitName)) return true;
    }
  }
  return false;
}

/**
 * Classify a mission's resolve effect for AI decision-making.
 * - "harm-target": hurts a specific target (use on opponent)
 * - "neutral": affects all players equally (ok unless it would kill us)
 * - "benefit-self": benefits the resolver (always good)
 */
function classifyMissionEffect(abilityText: string): "harm-target" | "neutral" | "benefit-self" {
  const text = abilityText.toLowerCase();
  // Neutral: affects all players equally
  if (text.includes("each player") || text.includes("all player")) {
    return "neutral";
  }
  // Missions that harm a specific target
  if (
    text.includes("target") &&
    (text.includes("loses") ||
      text.includes("lose") ||
      text.includes("defeat") ||
      text.includes("sacrifice") ||
      text.includes("commit") ||
      text.includes("exhaust") ||
      text.includes("on top of") ||
      (text.includes("into") && text.includes("deck")) ||
      (text.includes("return") && text.includes("hand")) ||
      text.includes("discard") ||
      text.includes("gains the cylon trait"))
  ) {
    return "harm-target";
  }
  return "benefit-self";
}

/**
 * Check if resolving a neutral mission would be dangerous for the AI.
 * E.g., "each player loses 2 influence" when AI has <= 2 influence.
 */
function isNeutralMissionDangerous(abilityText: string, player: PlayerState): boolean {
  const text = abilityText.toLowerCase();
  // Check for influence loss patterns: "each player loses X influence", "lose X influence"
  const lossMatch = text.match(/(?:lose|loses)\s+(\d+)\s+influence/);
  if (lossMatch) {
    const loss = parseInt(lossMatch[1]);
    if (player.influence <= loss) return true;
  }
  // Check for sacrifice patterns when AI has few units
  if (text.includes("sacrifice") && (text.includes("personnel") || text.includes("unit"))) {
    const unitCount = [...player.zones.alert, ...player.zones.reserve].filter(
      (s) => s.cards[0]?.faceUp,
    ).length;
    if (unitCount <= 1) return true;
  }
  return false;
}

// --- Triggered ability (Agro Ship / Flattop): use if we have a strong unit ---
function decideTrigger(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const useActions = actions.filter((a) => a.type === "useTriggeredAbility");
  const declineAction = actions.find((a) => a.type === "declineTrigger");

  if (useActions.length > 0) {
    // Pick the strongest unit to ready as a potential defender
    let bestAction = useActions[0];
    let bestPower = 0;
    for (const action of useActions) {
      if (action.targetInstanceId) {
        const def = findUnitDef(action.targetInstanceId, state.players[playerIndex], registry);
        const power = def?.power ?? 0;
        if (power > bestPower) {
          bestPower = power;
          bestAction = action;
        }
      }
    }
    // Use trigger if we found a unit with reasonable power
    if (bestPower >= 2) {
      return {
        type: "useTriggeredAbility",
        targetInstanceId: bestAction.targetInstanceId,
      };
    }
  }

  // Decline if no good targets
  if (declineAction) return { type: "declineTrigger" };
  return { type: "pass" };
}

// --- Cylon phase: challenge threats or pass ---
function decideCylonPhase(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const challengeAction = actions.find((a) => a.type === "challengeCylon");
  if (
    challengeAction?.selectableInstanceIds?.length &&
    challengeAction.selectableThreatIndices?.length
  ) {
    const bestUnit = pickStrongestUnit(
      challengeAction.selectableInstanceIds,
      state,
      playerIndex,
      registry,
    );
    if (bestUnit) {
      const unitDef = registry.cards[bestUnit.defId];
      const unitPower = unitDef?.power ?? 0;

      // Pick the weakest threat we can beat
      const threats = challengeAction.selectableThreatIndices
        .map((idx) => ({ idx, power: state.cylonThreats[idx]?.power ?? 0 }))
        .sort((a, b) => a.power - b.power);

      for (const threat of threats) {
        // Challenge if our power is close to or exceeds threat (mystic values add variance)
        if (unitPower >= threat.power - 2) {
          return {
            type: "challengeCylon",
            challengerInstanceId: bestUnit.instanceId,
            threatIndex: threat.idx,
          };
        }
      }
    }
  }

  return { type: "passCylon" };
}

// --- Helpers ---

/** Pick the best ability action to use during execution phase. */
function pickBestAbilityAction(
  abilityActions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): ValidAction | null {
  let bestAction: ValidAction | null = null;
  let bestScore = 0;
  const oppIdx = 1 - playerIndex;

  for (const action of abilityActions) {
    const defId = action.cardDefId;
    if (!defId) continue;
    const def = registry.cards[defId] ?? registry.bases[defId];
    if (!def) continue;

    let score = 1;
    const text = def.abilityText.toLowerCase();

    // High value: draw cards, gain influence, defeat opponent units
    if (text.includes("draw a card")) score += 5;
    if (text.includes("gain") && text.includes("influence")) score += 5;
    if (text.includes("defeat target")) score += 4;
    if (text.includes("exhaust target")) score += 3;
    if (text.includes("commit target")) score += 3;
    if (text.includes("ready target")) score += 3;
    if (text.includes("restore target")) score += 2;
    if (text.includes("+2 power") || text.includes("+1 power")) score += 2;
    if (text.includes("discard pile into your hand")) score += 3;

    // Lower value: complex or situational
    if (text.includes("sacrifice")) score -= 2;

    // Target-safety check: ensure we don't debuff own units or buff opponent units
    if (score > 0 && action.selectableInstanceIds?.length) {
      const effect = classifyEffect(def.abilityText);
      if (effect === "debuff") {
        const hasOppTarget = action.selectableInstanceIds.some((id) =>
          isOpponentUnit(state, oppIdx, id),
        );
        if (!hasOppTarget) score = -1;
      } else if (effect === "buff") {
        const hasOwnTarget = action.selectableInstanceIds.some((id) =>
          isOwnUnit(state, playerIndex, id),
        );
        if (!hasOwnTarget) score = -1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return bestAction;
}

function pickBestCardToPlay(
  playActions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction | null {
  const player = state.players[playerIndex];
  let bestScore = -Infinity;
  let bestIndex = -1;
  let bestTargetId: string | undefined;

  for (const action of playActions) {
    if (action.disabled) continue;
    if (!action.selectableCardIndices) continue;
    for (const idx of action.selectableCardIndices) {
      const card = player.hand[idx];
      if (!card) continue;
      const def = registry.cards[card.defId];
      if (!def) continue;

      let score = 0;
      // Prefer units (they stay in play)
      if (def.type === "personnel" || def.type === "ship") score += 10;
      // Prefer higher power
      if (def.power) score += def.power * 3;
      // Boost units that satisfy mission requirements (deploy toward resolving missions)
      if (def.type === "personnel" || def.type === "ship") {
        const needs = getMissionNeeds(player, registry);
        if (needs.length > 0 && unitSatisfiesMissionNeed(def, needs)) {
          score += 6; // significant boost to prioritize mission-enabling units
        }
      }
      // Prefer missions (free to play) — persistent/link are higher value
      if (def.type === "mission") {
        const cat = def.abilityId ? getMissionCategory(def.abilityId) : "one-shot";
        score += cat === "one-shot" ? 5 : 8;
      }
      // Events scored by abilityId
      if (def.type === "event") {
        score += scoreExecutionEvent(def, state, playerIndex, registry);
        // If event needs a target but none available, skip it
        if (def.abilityId) {
          const targets = getEventTargets(def.abilityId, state, playerIndex, "execution");
          if (targets && targets.length === 0) score = -Infinity;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
        bestTargetId = undefined; // reset for non-events
      }
    }
  }

  if (bestIndex >= 0 && bestScore > 0) {
    const card = player.hand[bestIndex];
    const def = card ? registry.cards[card.defId] : null;
    // For events with targets, pick the best target
    if (def?.type === "event" && def.abilityId) {
      bestTargetId = pickEventTarget(def, state, playerIndex, registry, "execution");
      // If the event needs a target but we couldn't find a good one, skip it
      const targets = getEventTargets(def.abilityId, state, playerIndex, "execution");
      if (targets && targets.length > 0 && !bestTargetId) return null;
    }
    const bestDef = card ? registry.cards[card.defId] : null;
    return {
      type: "playCard",
      cardIndex: bestIndex,
      targetInstanceId: bestTargetId,
      selectedStackIndices: bestDef?.cost
        ? computeOptimalStacksAI(player, bestDef.cost, registry)
        : undefined,
    };
  }
  return null;
}

function pickStrongestUnit(
  instanceIds: string[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): { instanceId: string; defId: string } | null {
  const player = state.players[playerIndex];
  let bestPower = -1;
  let bestUnit: { instanceId: string; defId: string } | null = null;

  for (const instanceId of instanceIds) {
    for (const stack of [...player.zones.alert, ...player.zones.reserve]) {
      const topCard = stack.cards[0];
      if (topCard?.instanceId === instanceId) {
        const def = registry.cards[topCard.defId];
        const power = def?.power ?? 0;
        if (power > bestPower) {
          bestPower = power;
          bestUnit = { instanceId, defId: topCard.defId };
        }
      }
    }
    // Also check hand (Raptor 432 flash defend)
    for (const card of player.hand) {
      if (card.instanceId === instanceId) {
        const def = registry.cards[card.defId];
        const power = def?.power ?? 0;
        if (power > bestPower) {
          bestPower = power;
          bestUnit = { instanceId, defId: card.defId };
        }
      }
    }
  }

  return bestUnit;
}

function findUnitDef(
  instanceId: string,
  player: {
    zones: {
      alert: { cards: { instanceId: string; defId: string }[] }[];
      reserve: { cards: { instanceId: string; defId: string }[] }[];
    };
  },
  registry: CardRegistry,
): CardDef | null {
  for (const stack of [...player.zones.alert, ...player.zones.reserve]) {
    const topCard = stack.cards[0];
    if (topCard?.instanceId === instanceId) {
      return registry.cards[topCard.defId] ?? null;
    }
  }
  return null;
}

/** Resolve a ValidAction into a concrete GameAction with required fields */
function resolveAction(
  action: ValidAction,
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  switch (action.type) {
    case "keepHand":
      return { type: "keepHand" };
    case "redraw":
      return { type: "redraw" };
    case "drawCards":
      return { type: "drawCards" };
    case "passResource":
      return { type: "passResource" };
    case "doneReorder":
      return { type: "doneReorder" };
    case "reorderStack":
      // AI doesn't reorder stacks — falls through to doneReorder in main logic
      return { type: "doneReorder" };
    case "pass":
      return { type: "pass" };
    case "challengePass":
      return { type: "challengePass" };
    case "passCylon":
      return { type: "passCylon" };

    case "playCard":
      if (action.selectableCardIndices?.length) {
        const pcIdx = action.selectableCardIndices[0];
        const pcPlayer = state.players[playerIndex];
        const pcCard = pcPlayer.hand[pcIdx];
        const pcDef = pcCard ? registry.cards[pcCard.defId] : null;
        return {
          type: "playCard",
          cardIndex: pcIdx,
          selectedStackIndices: pcDef?.cost
            ? computeOptimalStacksAI(pcPlayer, pcDef.cost, registry)
            : undefined,
        };
      }
      return { type: "pass" };

    case "playToResource":
      if (action.selectableCardIndices?.length) {
        const isSupply = action.description.includes("supply");
        return {
          type: "playToResource",
          cardIndex: action.selectableCardIndices[0],
          asSupply: isSupply,
          targetStackIndex: isSupply ? action.selectableStackIndices?.[0] : undefined,
        };
      }
      return { type: "passResource" };

    case "playAbility": {
      if (!action.selectableInstanceIds?.length) return { type: "pass" };
      const abDefId = action.cardDefId;
      const abText = abDefId
        ? (registry.bases[abDefId]?.abilityText ?? registry.cards[abDefId]?.abilityText ?? "")
        : "";
      const abEffect = classifyEffect(abText);
      const abOppIdx = 1 - playerIndex;

      // Player-targeting base abilities: pick opponent for negative effects, self for positive
      let targetId = action.targetInstanceId;
      if (!targetId && action.selectablePlayerIndices?.length) {
        const isNegative = abEffect === "debuff";
        const preferredTarget = isNegative ? abOppIdx : playerIndex;
        targetId = `player-${action.selectablePlayerIndices.includes(preferredTarget) ? preferredTarget : action.selectablePlayerIndices[0]}`;
      }

      // Multi-target: sort targets based on effect type
      if (action.multiTargetCount && action.multiTargetCount > 1) {
        const ownUnits = new Set<string>();
        for (const s of state.players[playerIndex].zones.alert) {
          if (s.cards[0]) ownUnits.add(s.cards[0].instanceId);
        }
        const oppUnits = new Set<string>();
        for (const s of state.players[abOppIdx].zones.alert) {
          if (s.cards[0]) oppUnits.add(s.cards[0].instanceId);
        }
        const selectable = action.selectableInstanceIds;
        const sorted = [...selectable].sort((a, b) => {
          if (abEffect === "buff") {
            // Own units first for buffs
            const aOwn = ownUnits.has(a) ? 0 : 1;
            const bOwn = ownUnits.has(b) ? 0 : 1;
            return aOwn - bOwn;
          }
          // Opponent units first for debuffs/neutral
          const aOpp = oppUnits.has(a) ? 0 : 1;
          const bOpp = oppUnits.has(b) ? 0 : 1;
          return aOpp - bOpp;
        });
        return {
          type: "playAbility",
          sourceInstanceId: action.selectableInstanceIds[0],
          targetInstanceIds: sorted.slice(0, action.multiTargetCount),
          abilityIndex: action.abilityIndex,
        };
      }

      // Single-target: if no target yet, pick based on effect type
      if (!targetId && action.selectableInstanceIds.length > 1) {
        if (abEffect === "debuff") {
          const oppTarget = action.selectableInstanceIds.find((id) =>
            isOpponentUnit(state, abOppIdx, id),
          );
          if (oppTarget) targetId = oppTarget;
          else return { type: "pass" };
        } else if (abEffect === "buff") {
          const ownTarget = action.selectableInstanceIds.find((id) =>
            isOwnUnit(state, playerIndex, id),
          );
          if (ownTarget) targetId = ownTarget;
          else return { type: "pass" };
        }
      }

      return {
        type: "playAbility",
        sourceInstanceId: action.selectableInstanceIds[0],
        targetInstanceId: targetId,
        abilityIndex: action.abilityIndex,
      };
    }

    case "resolveMission":
      if (action.selectableInstanceIds?.length) {
        // Pick a target for missions that require one
        let missionTarget: string | undefined;
        if (action.missionTargetIds?.length) {
          const oppIdx = 1 - playerIndex;
          const missionDefId = action.cardDefId;
          const missionDef = missionDefId ? registry.cards[missionDefId] : null;
          const effect = missionDef ? classifyMissionEffect(missionDef.abilityText) : "harm-target";

          if (effect === "harm-target") {
            // Target opponent's units for harmful missions
            const oppTarget = action.missionTargetIds.find((id) =>
              isOpponentUnit(state, oppIdx, id),
            );
            // Prefer opponent target; fallback to first (caller pre-filters dangerous cases)
            missionTarget = oppTarget ?? action.missionTargetIds[0];
          } else if (effect === "neutral") {
            // Neutral effects affect all players — just pick first valid target
            missionTarget = action.missionTargetIds[0];
          } else {
            // Beneficial — target own units
            const ownTarget = action.missionTargetIds.find((id) =>
              isOwnUnit(state, playerIndex, id),
            );
            missionTarget = ownTarget ?? action.missionTargetIds[0];
          }
        }
        return {
          type: "resolveMission",
          missionInstanceId: action.selectableInstanceIds[0],
          targetInstanceId: missionTarget,
          unitInstanceIds: [],
        };
      }
      return { type: "pass" };

    case "challenge":
      if (action.selectableInstanceIds?.length) {
        return {
          type: "challenge",
          challengerInstanceId: action.selectableInstanceIds[0],
          opponentIndex: 1 - playerIndex,
        };
      }
      return { type: "pass" };

    case "defend":
      if (action.selectableInstanceIds?.length) {
        return {
          type: "defend",
          defenderInstanceId: action.selectableInstanceIds[0],
        };
      }
      return { type: "defend", defenderInstanceId: null };

    case "playEventInChallenge":
      if (action.selectableCardIndices?.length) {
        const ceIdx = action.selectableCardIndices[0];
        const cePlayer = state.players[playerIndex];
        const ceCard = cePlayer.hand[ceIdx];
        const ceDef = ceCard ? registry.cards[ceCard.defId] : null;
        return {
          type: "playEventInChallenge",
          cardIndex: ceIdx,
          selectedStackIndices: ceDef?.cost
            ? computeOptimalStacksAI(cePlayer, ceDef.cost, registry)
            : undefined,
        };
      }
      return { type: "challengePass" };

    case "challengeCylon":
      if (action.selectableInstanceIds?.length && action.selectableThreatIndices?.length) {
        return {
          type: "challengeCylon",
          challengerInstanceId: action.selectableInstanceIds[0],
          threatIndex: action.selectableThreatIndices[0],
        };
      }
      return { type: "passCylon" };

    case "useTriggeredAbility":
      return {
        type: "useTriggeredAbility",
        targetInstanceId: action.targetInstanceId,
      };

    case "declineTrigger":
      return { type: "declineTrigger" };

    case "makeChoice":
      return { type: "makeChoice", choiceIndex: 0 };

    case "strafeChoice":
      return { type: "strafeChoice", challengeAs: "personnel" };

    default:
      return { type: "pass" };
  }
}

// --- Event target selection for AI ---

/** Pick the best target for a targeted event. */
function pickEventTarget(
  def: CardDef,
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
  context: "execution" | "challenge" | "cylon-challenge",
): string | undefined {
  if (!def.abilityId) return undefined;
  const targets = getEventTargets(def.abilityId, state, playerIndex, context);
  if (!targets || targets.length === 0) return undefined;
  if (targets.length === 1) return targets[0];

  const player = state.players[playerIndex];
  const effect = classifyEffect(def.abilityText ?? "");
  const isBuff = effect === "buff";
  const isDebuff = effect === "debuff";

  // During a challenge, prefer our own challenger/defender for buffs, opponent's for debuffs
  if (state.challenge) {
    const ownUnitId =
      state.challenge.challengerPlayerIndex === playerIndex
        ? state.challenge.challengerInstanceId
        : state.challenge.defenderInstanceId;
    const oppUnitId =
      state.challenge.challengerPlayerIndex === playerIndex
        ? state.challenge.defenderInstanceId
        : state.challenge.challengerInstanceId;

    if (isBuff && ownUnitId && targets.includes(ownUnitId)) return ownUnitId;
    if (isDebuff && oppUnitId && targets.includes(oppUnitId)) return oppUnitId;
  }

  // Outside challenge: for buffs, pick our strongest unit (alert or reserve)
  if (isBuff) {
    let bestId: string | undefined;
    let bestPow = -1;
    const ownZones = [...player.zones.alert, ...player.zones.reserve];
    for (const id of targets) {
      for (const stack of ownZones) {
        if (stack.cards[0]?.instanceId === id) {
          const d = registry.cards[stack.cards[0].defId];
          const pow = d?.power ?? 0;
          if (pow > bestPow) {
            bestPow = pow;
            bestId = id;
          }
        }
      }
    }
    if (bestId) return bestId;
  }

  // For debuffs, pick opponent's strongest unit (alert or reserve)
  if (isDebuff) {
    const opp = state.players[1 - playerIndex];
    let bestId: string | undefined;
    let bestPow = -1;
    const oppZones = [...opp.zones.alert, ...opp.zones.reserve];
    for (const id of targets) {
      for (const stack of oppZones) {
        if (stack.cards[0]?.instanceId === id) {
          const d = registry.cards[stack.cards[0].defId];
          const pow = d?.power ?? 0;
          if (pow > bestPow) {
            bestPow = pow;
            bestId = id;
          }
        }
      }
    }
    if (bestId) return bestId;
  }

  // For buffs/debuffs with no appropriate target found, don't help the opponent
  if (isBuff || isDebuff) return undefined;

  // Fallback: first target
  return targets[0];
}

// --- Event scoring by abilityId ---

/** Score an event for playing during the execution phase. Higher = better. */
function opponentHasUnits(state: GameState, playerIndex: number): boolean {
  const opp = state.players[1 - playerIndex];
  return (
    opp.zones.alert.some((s) => s.cards.length > 0) ||
    opp.zones.reserve.some((s) => s.cards.length > 0)
  );
}

function opponentHasPersonnel(
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): boolean {
  const opp = state.players[1 - playerIndex];
  for (const zone of [opp.zones.alert, opp.zones.reserve]) {
    for (const stack of zone) {
      if (stack.exhausted) continue;
      const top = stack.cards[0];
      if (!top) continue;
      const def = registry.cards[top.defId];
      if (def?.type === "personnel") return true;
    }
  }
  return false;
}

function scoreExecutionEvent(
  def: CardDef,
  state: GameState,
  playerIndex: number,
  registry?: CardRegistry,
): number {
  const id = def.abilityId;
  if (!id) return 1;

  // Don't waste events that target opponent units when they have none
  const needsOpponentUnits: string[] = [
    "endless-task",
    "downed-pilot",
    "grounded",
    "setback",
    "still-no-contact",
  ];
  if (needsOpponentUnits.includes(id) && !opponentHasUnits(state, playerIndex)) return 0;

  // Don't waste events that need opponent personnel when they have none
  const needsOpponentPersonnel: string[] = [
    "military-coup",
    "distraction",
    "under-arrest",
    "stranded",
  ];
  if (
    needsOpponentPersonnel.includes(id) &&
    registry &&
    !opponentHasPersonnel(state, playerIndex, registry)
  )
    return 0;

  // Removal / defeat events — very strong
  if (
    [
      "angry",
      "suicide-bomber",
      "them-or-us",
      "left-behind",
      "like-a-ghost-town",
      "catastrophe",
      "site-of-betrayal",
      "this-tribunal",
    ].includes(id)
  )
    return 8;

  // State disruption: opponent-choice, exhaust/commit opponent
  if (
    [
      "downed-pilot",
      "endless-task",
      "grounded",
      "hangar-deck-fire",
      "network-hacking",
      "setback",
      "still-no-contact",
      "dissension",
      "military-coup",
      "sneak-attack",
      "distraction",
      "condition-two",
      "to-the-victor",
      "under-arrest",
      "stranded",
      "painful-recovery",
    ].includes(id)
  )
    return 6;

  // Self-buff: ready, restore, draw, influence
  if (
    [
      "condition-one",
      "determination",
      "massive-assault",
      "resupply",
      "reformat",
      "advanced-planning",
      "test-of-faith",
      "high-stakes-game",
      "executive-privilege",
      "showdown",
      "martial-law",
    ].includes(id)
  )
    return 5;

  // Hand disruption
  if (
    ["act-of-contrition", "crackdown", "cylon-computer-virus", "full-system-malfunction"].includes(
      id,
    )
  )
    return 4;

  // Trait/keyword grants, bounce
  if (
    [
      "cylons-on-brain",
      "everyone-green",
      "unexpected",
      "boarding-party",
      "out-of-sight",
      "bingo-fuel",
      "sick-bay",
      "double-trouble",
      "there-are-many-copies",
      "top-off-tank",
      "crushing-reality",
    ].includes(id)
  )
    return 3;

  // Power buffs (less useful outside challenge)
  if (
    [
      "fire-support",
      "fury",
      "cylon-missile-battery",
      "power-of-prayer",
      "you-gave-yourself-over",
      "concentrated-firepower",
      "covering-fire",
      "cylon-surprise",
      "swearing-in",
      "strange-wingman",
      "decoys",
    ].includes(id)
  )
    return 1;

  // Misc / deferred
  return 2;
}

/** Score an event for playing during a challenge. Higher = better. */
function scoreChallengeEvent(def: CardDef, isChallenger: boolean, isCylon: boolean): number {
  const id = def.abilityId;
  if (!id) return 0;

  // Power buffs — very valuable in challenges
  if (
    [
      "fire-support",
      "fury",
      "power-of-prayer",
      "concentrated-firepower",
      "covering-fire",
      "cylon-surprise",
      "swearing-in",
      "strange-wingman",
      "you-gave-yourself-over",
      "cylon-missile-battery",
    ].includes(id)
  )
    return 8;

  // Stims / Unwelcome Visitor — strong challenge buffs (+4)
  if (["stims", "unwelcome-visitor"].includes(id)) return 9;

  // Power debuffs
  if (["outmaneuvered", "vision-of-serpents", "vulnerable-supplies"].includes(id)) return 7;

  // Conditional buffs
  if (id === "presidential-candidate" && !isChallenger) return 6;
  if (id === "winning-hand" && isChallenger) return 6;
  if (id === "wounded-in-action" && !isChallenger) return 6;

  // Cylon-specific
  if (id === "lest-we-forget" && isCylon) return 7;
  if (id === "treacherous-toaster" && isCylon) return 7;

  // Challenge manipulation
  if (["channel-lords", "spot-judgment", "false-sense-security", "discourage-pursuit"].includes(id))
    return 6;

  // Draw + buff combos
  if (["special-delivery", "strafing-run", "boarding-party", "out-of-sight"].includes(id)) return 5;

  // Bounce / removal during challenge
  if (["bingo-fuel", "sick-bay"].includes(id)) return 4;

  // Sign: end challenge (situational — usually bad for us)
  if (id === "sign") return 1;

  // Influence prevention
  if (["executive-privilege", "standoff"].includes(id)) return 3;

  // State changes playable in challenge
  if (id === "condition-two" || id === "sneak-attack" || id === "martial-law") return 3;

  // Crackdown (discard a card from opponent)
  if (id === "crackdown") return 2;

  return 0;
}
