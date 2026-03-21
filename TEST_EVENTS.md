# BSG CCG — Event Ability Browser Test Scenarios

Paste these `__bsg_send` calls into the browser console to set up debug scenarios for testing event abilities.

## Card ID Quick Reference

### Events Used in Tests

| ID       | Name                    | Cost  | Effect                                       |
| -------- | ----------------------- | ----- | -------------------------------------------- |
| BSG1-009 | Act Of Contrition       | L2    | Reveal opponent hand, discard 1              |
| BSG1-010 | Advanced Planning       | L1    | Look at top 5, keep best on top              |
| BSG1-011 | Angry                   | S3    | Commit+exhaust personnel, defeat target      |
| BSG1-012 | Bingo Fuel              | P2    | Return alert ship to hand                    |
| BSG1-013 | Catastrophe             | P3    | Defeat persistent mission                    |
| BSG1-014 | Channel Lords Of Kobol  | P2    | Double mystic reveal                         |
| BSG1-015 | Condition One           | L2    | Ready target unit                            |
| BSG1-016 | Condition Two           | S2    | Commit target unit                           |
| BSG1-017 | Crackdown               | S1    | Opponent discards 1                          |
| BSG1-018 | Cylon Computer Virus    | L1+S1 | All discard, redraw                          |
| BSG1-019 | Cylon Missile Battery   | L1    | Cylon unit +2 power                          |
| BSG1-020 | Cylons Look Like Humans | S2    | Mill per Cylon count                         |
| BSG1-022 | Dissension              | S2    | Exhaust all reserve                          |
| BSG1-023 | Distraction             | S2    | Commit personnel, commit+exhaust target      |
| BSG1-024 | Downed Pilot            | P2    | Opponent: commit ship or sacrifice personnel |
| BSG1-025 | Endless Task            | S1    | Target: commit or exhaust unit               |
| BSG1-026 | Executive Privilege     | P2    | Prevent influence loss                       |
| BSG1-027 | Fire Support            | S2    | Target unit +2 power                         |
| BSG1-028 | Fury                    | P2    | Target unit +X (mystic value)                |
| BSG1-029 | Grounded                | P3    | Opponent: commit ship or all personnel       |
| BSG1-030 | Hangar Deck Fire        | L2+S1 | Opponent: sacrifice ship or supply           |
| BSG1-031 | High Stakes Game        | P2    | Reveal hands, highest mystic gains 2         |
| BSG1-032 | Martial Law             | S2    | Politicians can't defend                     |
| BSG1-033 | Military Coup           | S1    | Exhaust own, exhaust opponent's              |
| BSG1-035 | Networked Computers     | L3    | Mystic contest, recover from discard         |
| BSG1-036 | Outmaneuvered           | P1    | Target ship -2 power                         |
| BSG1-037 | Painful Recovery        | S1    | Cylon to deck, commit+exhaust target         |
| BSG1-038 | Power Of Prayer         | P1    | Reveal mystic, +X power                      |
| BSG1-040 | Reformat                | L1+S1 | Discard X, draw X                            |
| BSG1-042 | Sick Bay                | P2    | Return alert personnel to hand               |
| BSG1-043 | Sneak Attack            | P1    | Commit all Fighters                          |
| BSG1-044 | Standoff                | S2    | Prevent influence gain                       |
| BSG1-045 | Still No Contact        | S2    | Opponent: commit or sacrifice personnel      |
| BSG1-046 | Stims                   | S1    | Challenging Pilot +4, exhaust after          |
| BSG1-047 | Stranded                | S3    | Shuffle reserve personnel into deck          |
| BSG1-048 | Suicide Bomber          | S2    | Sacrifice Cylon, defeat 2 personnel          |
| BSG1-049 | Test Of Faith           | P2    | Target gains 1 influence                     |
| BSG1-050 | Them Or Us              | S1    | Sacrifice ship, defeat personnel             |
| BSG1-051 | Under Arrest            | L2    | Personnel on top of deck                     |
| BSG1-052 | Vision Of Serpents      | S2    | Target personnel -2 power                    |
| BSG1-053 | Winning Hand            | P1    | Challenging personnel +2 power               |
| BSG1-054 | Wounded In Action       | P2    | Undefended challenger -2 power               |
| BSG1-055 | You Gave Yourself Over  | P1    | Civilian unit +2 power                       |
| BSG2-007 | Anti-Radiation Dosage   | S1    | Immune to power changes                      |
| BSG2-008 | Boarding Party          | L2    | Ship gains Scramble + draw                   |
| BSG2-009 | Concentrated Firepower  | S2    | +X power (supply count)                      |
| BSG2-011 | Crushing Reality        | S1    | Exhaust target mission                       |
| BSG2-012 | Cylon Surprise          | L1    | Cylon Machine +2 power                       |
| BSG2-013 | Cylons On The Brain     | P2    | Personnel gains Cylon trait                  |
| BSG2-014 | Determination           | L1    | Restore target unit                          |
| BSG2-015 | Discourage Pursuit      | P2    | Exhaust defender, immune, defeat challenger  |
| BSG2-016 | Double Trouble          | P3    | Extract Cylon from stack                     |
| BSG2-017 | Everyone's Green        | P2    | Cylon loses Cylon trait + draw               |
| BSG2-018 | Fallout Shelter         | S2    | Immune to all effects                        |
| BSG2-019 | False Sense Of Security | S2    | Opponent double mystic                       |
| BSG2-020 | Full Disclosure         | P2    | All reveal hands                             |
| BSG2-021 | Full System Malfunction | S5    | All discard hands                            |
| BSG2-022 | Left Behind             | P2+S3 | Defeat all units                             |
| BSG2-024 | Like a Ghost Town       | S3    | Defeat all Civilian units                    |
| BSG2-025 | Massive Assault         | L3+S1 | Ready Capital Ships + Fighters               |
| BSG2-026 | Out of Sight            | L2    | Personnel gains Scramble + draw              |
| BSG2-027 | Raiding Farms           | L3    | Defeat bare asset                            |
| BSG2-028 | Resupply                | L2    | Draw X (supply count)                        |
| BSG2-029 | Showdown                | P2    | No challenges this phase                     |
| BSG2-030 | Site of Betrayal        | P3    | Defeat all unresolved missions               |
| BSG2-031 | Special Delivery        | L2    | Personnel +1+Scramble+draw                   |
| BSG2-032 | Spot Judgment           | S2    | Double mystic, choose best                   |
| BSG2-033 | Strafing Run            | S2    | Ship +1+Strafe+draw                          |
| BSG2-034 | Strange Wingman         | L1    | Fighter +X (Cylon ships)                     |
| BSG2-035 | Swearing In             | P1    | Politician +2 power                          |
| BSG2-036 | There Are Many Copies   | P2    | Cylon from discard to hand                   |
| BSG2-037 | This Tribunal Is Over   | P2    | Defeat target mission                        |
| BSG2-038 | To The Victor           | S2    | Exhaust target personnel                     |
| BSG2-039 | Top Off The Tank        | L3    | Event becomes supply card                    |
| BSG2-040 | Treacherous Toaster     | L2    | Cylon threat +2 + draw                       |
| BSG2-041 | Unexpected              | P1    | Cylon ship loses Cylon trait                 |
| BSG2-042 | ...Sign                 | P2    | End ship challenge, both committed           |
| BSG2-043 | Unwelcome Visitor       | S1    | Cylon personnel +4, defeat at end            |
| BSG2-044 | Vulnerable Supplies     | S2    | Opposing unit -X (bare assets)               |

### Common Test Units

| ID       | Name                           | Type      | Power | Traits         |
| -------- | ------------------------------ | --------- | ----- | -------------- |
| BSG1-098 | Apollo, Ace Pilot              | Personnel | 2     | Pilot          |
| BSG1-099 | Apollo, Commander Air Group    | Personnel | 2     | Pilot          |
| BSG1-102 | Billy Keikeya, Press Secretary | Personnel | 1     | Politician     |
| BSG1-103 | Boomer, Hell Of A Pilot        | Personnel | 2     | Cylon, Pilot   |
| BSG1-107 | Centurion Assassin             | Personnel | 2     | Cylon, Machine |
| BSG1-117 | Dr. Baltar, Award Winner       | Personnel | 1     | Civilian       |
| BSG1-140 | Tom Zarek, Sagittaron Rep      | Personnel | 2     | Politician     |
| BSG1-146 | Colonial Shuttle               | Ship      | 1     | Transport      |
| BSG1-147 | Colonial Viper 113             | Ship      | 2     | Fighter        |
| BSG1-172 | Skirmishing Raider             | Ship      | 4     | Cylon, Fighter |

### Bases

| ID       | Name             | Resource   | Hand |
| -------- | ---------------- | ---------- | ---- |
| BSG1-004 | Colonial One     | Persuasion | 4    |
| BSG1-005 | Ragnar Anchorage | Logistics  | 5    |
| BSG1-007 | Galactica        | Security   | 4    |

---

## Category 1: Power Buffs

### Fire Support (+2 power)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-027"],
      alert: ["BSG1-102"],
      assets: ["BSG1-108"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Fire Support targeting Billy. Verify +2 power buff in log.

### Outmaneuvered (-2 power to ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-036"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-146"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Outmaneuvered targeting Colonial Shuttle. Verify -2 power.

### Cylon Missile Battery (+2 to Cylon unit)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG1-019"],
      alert: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Cylon Missile Battery targeting Boomer. Verify +2 power.

### Swearing In (+2 to Politician)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-035"],
      alert: ["BSG1-102"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Swearing In targeting Billy (Politician). Verify +2 power.

---

## Category 2: Unit State Management

### Condition One (Ready target)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG1-015"],
      alert: [],
      reserve: ["BSG1-102"],
      assets: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Condition One. Verify Billy moves from reserve to alert.

### Condition Two (Commit target)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-016"],
      alert: [],
      baseSupplyCards: 1,
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Condition Two targeting opponent's Billy. Verify moves to reserve.

### Dissension (Exhaust all reserve)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-022"],
      alert: [],
      baseSupplyCards: 1,
      reserve: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: [],
      reserve: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Dissension. Verify all reserve cards are exhausted (face-down).

### Sneak Attack (Commit all Fighters)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-043"],
      alert: ["BSG1-147"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-147"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Sneak Attack. Verify all Fighter ships committed to reserve.

### Massive Assault (Ready Capital Ships + Fighters)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG2-025"],
      alert: [],
      baseSupplyCards: 2,
      assets: ["BSG1-108"],
      reserve: ["BSG1-147", "BSG2-148"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      reserve: ["BSG1-147"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Massive Assault. Verify Fighter moves from reserve to alert.

---

## Category 3: Unit Defeat / Removal

### Angry (Commit+exhaust own, defeat target)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-011"],
      alert: ["BSG1-098"],
      baseSupplyCards: 2,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Angry targeting opponent's Billy. Verify Apollo committed+exhausted, Billy defeated.

### Left Behind (Defeat all units)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-022"],
      alert: ["BSG1-098"],
      baseSupplyCards: 1,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      assets: ["BSG2-084", "BSG2-084", "BSG2-084"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Left Behind. Verify ALL units on both sides defeated.

### Like a Ghost Town (Defeat Civilians)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-024"],
      alert: ["BSG1-098"],
      baseSupplyCards: 3,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-117"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Like a Ghost Town. Verify Dr. Baltar (Civilian) defeated, Apollo survives.

### Them Or Us (Sacrifice ship, defeat personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-050"],
      alert: ["BSG1-146"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Them Or Us. Verify Colonial Shuttle sacrificed, Billy defeated.

---

## Category 4: Card Movement / Bounce

### Bingo Fuel (Ship to hand)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-012"],
      alert: ["BSG1-146"],
      baseSupplyCards: 3,
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-146"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Bingo Fuel. Verify Colonial Shuttle returns to opponent's hand.

### Sick Bay (Personnel to hand)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-042"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 3,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Sick Bay. Verify Billy returns to opponent's hand.

### Under Arrest (Personnel to top of deck)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG1-051"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 3,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Under Arrest. Verify Billy removed from board, placed on deck top.

### Painful Recovery (Cylon to deck, commit+exhaust target)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-037"],
      alert: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Painful Recovery. Verify Boomer on deck top, Billy committed+exhausted.

---

## Category 5: Mission Manipulation

### This Tribunal Is Over (Defeat mission)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-037"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-060"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play This Tribunal Is Over. Verify mission defeated (goes to discard).

### Crushing Reality (Exhaust mission)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-011"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-060"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Crushing Reality. Verify mission is exhausted (face-down).

### Site of Betrayal (Defeat all unresolved missions)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-030"],
      alert: ["BSG1-060"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 2,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-073"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Site of Betrayal. Verify ALL missions on both sides defeated.

---

## Category 6: Hand / Deck Manipulation

### Crackdown (Opponent discards)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-017"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      hand: ["BSG1-098"],
      alert: [],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Crackdown. Verify opponent discards a card.

### Cylon Computer Virus (All discard+redraw)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG1-018", "BSG1-098"],
      alert: [],
      assets: ["BSG1-099"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103", "BSG1-104", "BSG1-117", "BSG1-140"],
    },
    player1: {
      baseId: "BSG1-007",
      hand: ["BSG1-098", "BSG1-099"],
      alert: [],
      influence: 10,
      deck: ["BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103", "BSG1-104"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Cylon Computer Virus. Verify all discard and redraw to starting hand size.

### Advanced Planning (Top 5 manipulation)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG1-010"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Advanced Planning. Verify deck size unchanged, best mystic on top.

---

## Category 7: Influence Manipulation

### Executive Privilege (Prevent influence loss)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-026"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 2,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Executive Privilege (or test Expedite first), then let opponent challenge + use Galactica. Verify no influence loss.

### Test of Faith (Gain 1 influence)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-102", "BSG1-049"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 4,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play BSG1-102 personnel (2 persuasion) with 4 supply → 2 excess persuasion triggers Expedite for Test of Faith. Verify +1 influence.

### Standoff (Prevent influence gain)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      assets: [],
      hand: ["BSG1-044"],
      alert: ["BSG1-127"],
      deck: ["BSG1-098", "BSG1-099"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-004",
      alert: [],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Standoff. Verify no player can gain influence.

---

## Category 8: Challenge Manipulation

### Showdown (No challenges)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-029"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Showdown. Verify no challenge button available afterwards.

### Martial Law (Politicians can't defend)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-032"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Martial Law, then challenge. Verify Billy (Politician) can't defend.

---

## Category 9: Trait / Keyword Modification

### Boarding Party (Ship gains Scramble + draw)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG2-008"],
      alert: ["BSG1-146"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-138"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:**

1. Play Boarding Party targeting Colonial Shuttle → log should show "draws a card" and Scramble badge appears on shuttle
2. Pass — Spectre should challenge Colonial Shuttle with Starbuck (power 4)
3. Scramble should allow the ship to defend as personnel

### Cylons on the Brain (Personnel gains Cylon)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-013"],
      alert: ["BSG1-102"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Cylons on the Brain. Verify Billy gains Cylon trait.

### Everyone's Green (Cylon loses Cylon + draw)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-017"],
      alert: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Everyone's Green targeting Boomer. Verify loses Cylon trait, draw 1.

### Unexpected (Cylon ship loses Cylon)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG2-041"],
      alert: ["BSG1-172"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Unexpected targeting Skirmishing Raider. Verify loses Cylon trait.

---

## Category 10: Cylon / Special

### Cylons Look Like Humans (Mill per Cylon)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-020"],
      alert: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-104", "BSG1-117"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Cylons Look Like Humans. Player 0 mills 1 (has Boomer/Cylon), Player 1 mills 0.

---

## Category 11: Effect Immunity

### Anti-Radiation Dosage (Power immunity)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-007"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Anti-Radiation Dosage on Apollo. Verify immune to power-changing effects.

### Fallout Shelter (All effect immunity)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-018"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Fallout Shelter on Apollo. Verify immune to ALL effects.

---

## Category 12: Opponent-Choice Events

### Downed Pilot (Commit ship or sacrifice personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-024"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
      baseSupplyCards: 1,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-146"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Downed Pilot. Verify opponent commits ship (or sacrifices if no ship).

### Grounded (Commit ship or all personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-029"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102", "BSG1-098"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Grounded. No ships = all personnel committed.

---

## Category 13: Complex Effects

### Distraction (Commit own, commit+exhaust target)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-023"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Distraction targeting Billy. Verify Apollo committed, Billy committed+exhausted.

### Military Coup (Exhaust own, exhaust opponent's)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-033"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Military Coup targeting Billy. Verify Apollo exhausted, Billy exhausted.

---

## Category 14: Special Buffs

### Concentrated Firepower (+X based on supply)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-009"],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Add supply cards to base, play Concentrated Firepower. Verify +X based on supply count.

### Strange Wingman (Fighter +X = Cylon ships)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG2-034"],
      alert: ["BSG1-147", "BSG1-172"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Strange Wingman targeting Viper. Verify +1 power (1 Cylon ship: Skirmishing Raider).

### Special Delivery (Personnel +1 + Scramble + draw)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-005",
      hand: ["BSG2-031"],
      alert: ["BSG1-102"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Special Delivery. Verify +1 power, Scramble keyword, draw 1.

### Strafing Run (Ship +1 + Strafe + draw)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG2-033"],
      alert: ["BSG1-146"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

**Test:** Play Strafing Run. Verify +1 power, Strafe keyword, draw 1.
