import type {
  GameState,
  GameAction,
  ValidAction,
  CardRegistry,
  CardDef,
  BaseCardDef,
} from "@bsg/shared";

// ============================================================
// BSG CCG — AI Decision Engine
// Pure function: given game state + valid actions, returns a GameAction.
// ============================================================

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

  // --- Ready step 5: done reordering ---
  if (phase === "ready" && state.readyStep === 5) {
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

  // --- Challenge: Sniper — AI as challenger picks opponent's defender ---
  if (
    state.challenge?.waitingForDefender &&
    state.challenge.defenderSelector === "challenger" &&
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

  // Prefer playing an asset that matches our base resource
  for (const idx of deployAction.selectableCardIndices) {
    const card = player.hand[idx];
    if (!card) continue;
    const def = registry.cards[card.defId];
    if (def?.resource === baseDef?.resource) {
      return { type: "playToResource", cardIndex: idx, asSupply: false };
    }
  }

  // Any card with a resource as an asset
  for (const idx of deployAction.selectableCardIndices) {
    const card = player.hand[idx];
    if (!card) continue;
    const def = registry.cards[card.defId];
    if (def?.resource) {
      return { type: "playToResource", cardIndex: idx, asSupply: false };
    }
  }

  // Fall back to supply card under first stack
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

  // Priority 2: Resolve a mission if possible
  const missionAction = actions.find((a) => a.type === "resolveMission");
  if (missionAction) {
    return resolveAction(missionAction, state, playerIndex, registry);
  }

  // Priority 3: Challenge with our strongest unit
  const challengeAction = actions.find((a) => a.type === "challenge");
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

// --- Sniper: AI as challenger picks which opponent unit defends ---
function decideSniperDefenderChoice(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  if (!state.challenge) return { type: "defend", defenderInstanceId: null };

  const challengerDef = findUnitDef(
    state.challenge.challengerInstanceId,
    state.players[playerIndex],
    registry,
  );
  const challengerPower = challengerDef?.power ?? 0;

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

  // Force the weakest unit to defend if we can likely beat it
  if (weakest && challengerPower > weakest.power) {
    return { type: "defend", defenderInstanceId: weakest.instanceId };
  }

  // Otherwise choose undefended (opponent loses influence)
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
    // Otherwise use any base ability available
    return resolveAction(baseAbilityActions[0], state, playerIndex, registry);
  }

  // Priority 2: Use unit abilities that buff our unit or debuff opponent
  const unitAbilityActions = actions.filter(
    (a) => a.type === "playAbility" && a.cardDefId && !registry.bases[a.cardDefId],
  );
  if (unitAbilityActions.length > 0) {
    // Prefer abilities that target our own challenger/defender for buffs
    const ownUnitId2 = isChallenger
      ? state.challenge?.challengerInstanceId
      : state.challenge?.defenderInstanceId;
    const buffOwn2 = unitAbilityActions.find((a) => a.targetInstanceId === ownUnitId2);
    if (buffOwn2) {
      return resolveAction(buffOwn2, state, playerIndex, registry);
    }
    // Use other unit abilities (debuffs, etc.)
    return resolveAction(unitAbilityActions[0], state, playerIndex, registry);
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
      return { type: "playEventInChallenge", cardIndex: bestEventIdx };
    }
  }

  return { type: "challengePass" };
}

// --- Pending choice (Celestra): pick card with higher mystic value ---
function decidePendingChoice(
  actions: ValidAction[],
  _state: GameState,
  _playerIndex: number,
  registry: CardRegistry,
): GameAction {
  const choiceActions = actions.filter((a) => a.type === "makeChoice");
  if (choiceActions.length === 0) return { type: "pass" };

  // Pick the card with higher mystic value to keep on top
  let bestIdx = 0;
  let bestMystic = -1;
  for (let i = 0; i < choiceActions.length; i++) {
    const defId = choiceActions[i].cardDefId;
    if (defId) {
      const def = registry.cards[defId];
      const mystic = def?.mysticValue ?? 0;
      if (mystic > bestMystic) {
        bestMystic = mystic;
        bestIdx = i;
      }
    }
  }
  return { type: "makeChoice", choiceIndex: bestIdx };
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
  _state: GameState,
  _playerIndex: number,
  registry: CardRegistry,
): ValidAction | null {
  // Score each ability action
  let bestAction: ValidAction | null = null;
  let bestScore = 0;

  for (const action of abilityActions) {
    const defId = action.cardDefId;
    if (!defId) continue;
    const def = registry.cards[defId];
    if (!def) continue;

    let score = 1; // Base score for having an ability
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
      // Prefer missions (free to play)
      if (def.type === "mission") score += 5;
      // Events scored by abilityId
      if (def.type === "event") score += scoreExecutionEvent(def);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }
  }

  if (bestIndex >= 0) {
    return { type: "playCard", cardIndex: bestIndex };
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
    case "pass":
      return { type: "pass" };
    case "challengePass":
      return { type: "challengePass" };
    case "passCylon":
      return { type: "passCylon" };

    case "playCard":
      if (action.selectableCardIndices?.length) {
        return { type: "playCard", cardIndex: action.selectableCardIndices[0] };
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

    case "playAbility":
      if (action.selectableInstanceIds?.length) {
        return {
          type: "playAbility",
          sourceInstanceId: action.selectableInstanceIds[0],
          targetInstanceId: action.targetInstanceId,
        };
      }
      return { type: "pass" };

    case "resolveMission":
      if (action.selectableInstanceIds?.length) {
        return {
          type: "resolveMission",
          missionInstanceId: action.selectableInstanceIds[0],
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
        return {
          type: "playEventInChallenge",
          cardIndex: action.selectableCardIndices[0],
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

// --- Event scoring by abilityId ---

/** Score an event for playing during the execution phase. Higher = better. */
function scoreExecutionEvent(def: CardDef): number {
  const id = def.abilityId;
  if (!id) return 1;

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
