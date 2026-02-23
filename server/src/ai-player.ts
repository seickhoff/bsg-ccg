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

  // Priority 4: Use a base ability if available
  const abilityAction = actions.find((a) => a.type === "playAbility");
  if (abilityAction?.selectableInstanceIds?.length) {
    return resolveAction(abilityAction, state, playerIndex, registry);
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

// --- Challenge effects (step 2): play events or pass ---
function decideChallengeEffects(
  actions: ValidAction[],
  state: GameState,
  playerIndex: number,
  registry: CardRegistry,
): GameAction {
  // Play power-buffing events if we have one
  const eventAction = actions.find((a) => a.type === "playEventInChallenge");
  if (eventAction?.selectableCardIndices?.length) {
    const player = state.players[playerIndex];
    for (const idx of eventAction.selectableCardIndices) {
      const card = player.hand[idx];
      if (!card) continue;
      const def = registry.cards[card.defId];
      if (!def) continue;
      // Play events that buff power or debuff opponent
      const text = def.abilityText.toLowerCase();
      if (text.includes("power") || text.includes("influence")) {
        return { type: "playEventInChallenge", cardIndex: idx };
      }
    }
  }

  return { type: "challengePass" };
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
      // Events are situational, lower priority
      if (def.type === "event") score += 2;

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

    default:
      return { type: "pass" };
  }
}
