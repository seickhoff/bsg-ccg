# Personnel Ability Test Scenarios (Browser UI)

Paste any scenario into the browser console via `__bsg_send(...)`.
After loading, use the UI to interact. Check valid actions for available abilities.

---

## Simple Commit Abilities (No Target)

### Laura Roslin, Colonial President — "Commit: Draw a card"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-125"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Laura Roslin, Madame President — "Commit: Gain 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-127"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Boomer, Saboteur — "Commit: All players lose 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-105"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

---

## Commit Power Buffs (During Challenge)

### Helo, Flight Officer — "Commit: Target Pilot gets +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-122", "BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// Challenge with Apollo (BSG1-098, Pilot), then use Helo's ability
```

### Ellen Tigh, Power Behind the XO — "Commit: Target Officer gets +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-105", "BSG1-100"],
      deck: ["BSG1-101", "BSG1-102", "BSG1-098"],
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
// Challenge with Apollo Political Liaison (BSG1-100, Officer), then use Ellen's ability
```

### Dr. Cottle, Bearer of Bad News — "Commit: Target personnel gets -2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-101", "BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// Challenge, opponent defends, then use Cottle to debuff defender
```

### Crashdown / D'Anna / Adama — "Commit: Target challenging unit gets +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-110", "BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-110 = Crashdown Expert ECO. Challenge with Apollo, then use Crashdown's ability
```

### Helo, Protector — "Commit: Target other defending personnel gets +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG2-114", "BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-114 = Helo Protector. Challenge, opponent defends with Billy, Helo buffs defender
```

---

## Target Manipulation

### Galen Tyrol, CPO — "Commit: Ready target ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-120"], reserve: ["BSG1-144"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-120 = Tyrol CPO, BSG1-144 = Astral Queen in reserve
```

### Cally, Cheerful Mechanic — "Commit: Restore target ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-090", "BSG1-144"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Exhaust the ship first (manually or through another action), then use Cally to restore
```

### Simon, Caring Doctor — "Commit: Restore target personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-124", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-124 = Simon. Need to exhaust Apollo first, then use Simon to restore
```

### Doral, Tour Guide — "Commit: Exhaust target ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-097"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-144"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-097 = Doral Tour Guide. Exhaust opponent's ship
```

### Number Six, Secret Companion — "Commit: Exhaust target other personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-132"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-132 = Number Six Secret Companion (Vision). Exhaust opponent's personnel
```

### Dr. Baltar, Science Advisor — "Commit: Defeat target exhausted personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-118", "BSG1-132"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-118 = Baltar Science Advisor. Use Six to exhaust target first, then Baltar to defeat
```

### Centurion Harasser — "Commit: Commit target personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-092"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-092 = Centurion Harasser. Commit opponent's personnel to reserve
```

### Laura Roslin, Instigator — "Commit: Ready target mission"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-116"], reserve: ["BSG1-009"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-116 = Roslin Instigator. BSG1-009 = mission in reserve
```

---

## Keyword/Trait Grants

### Apollo, Distant Son — "Commit: Target other personnel gains Strafe"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-085", "BSG1-100"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Leoben, Snake in the Grass — "Commit: Target personnel gains Cylon trait"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-118", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### William Adama, Tactician — "Commit: Target other personnel gains Sniper"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-130", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

---

## Lock-Down Abilities

### Saul Tigh, Disciplinarian — "Commit+Exhaust: Commit+exhaust target personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-123"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Hadrian, Head of Tribunal — "Commit: C+E target personnel power <= 2"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-110"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-102 = Billy (power 1), valid target for power <= 2
```

### Hadrian, Investigator — "Commit: C+E target Enlisted or Cylon personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-111"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-115"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-115 = Dee Dradis Operator (Enlisted)
```

---

## Commit+Exhaust — Recovery / Bounce

### Crashdown, Sensor Operator — "C+E: Recover any card from discard to hand"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-111"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Play a card first to get something in discard, or test from existing discard
```

### Starbuck, Maverick — "C+E: Return target alert personnel to hand"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-126"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Starbuck, Resistance Fighter — "C+E: Exhaust target resource stack"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-127"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Starbuck, Uncooperative Patient — "C+E: Defeat target Cylon personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-128"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-103"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-103 = Boomer (Cylon)
```

### Number Six, Caprican Operative — "C+E: Ready target other Cylon personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-131"], reserve: ["BSG1-103"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-131 = Six Caprican, BSG1-103 = Boomer (Cylon) in reserve
```

---

## Challenge-Only Abilities

### Dr. Cottle, Military Surgeon — "Commit: Loser exhausted instead of defeated"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-103", "BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-141"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Apollo, opponent defends with Adama, use Cottle during challenge
```

### Elosha, Priestess — "Commit: Double mystic value reveal"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-108", "BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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
// Challenge, opponent defends, use Elosha before mystic reveal
```

---

## Commit-Other / Sacrifice Cost

### Dr. Baltar, Defense Contractor — "Commit other personnel: Self gets +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-098", "BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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
// BSG2-098 = Baltar Defense Contractor. Challenge with Baltar, commit Apollo for +1
```

### Centurion Hunter — "Commit other Cylon: Self gets +2 power (once/turn)"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-093", "BSG1-103"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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
// BSG2-093 = Centurion Hunter, BSG1-103 = Boomer (Cylon to commit)
```

### Dr. Baltar, Survivor — "Sacrifice other personnel: Self gets +3 power (once/turn)"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-100", "BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
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
// BSG2-100 = Baltar Survivor. Challenge with Baltar, sacrifice Apollo for +3
```

---

## Dual / Complex Abilities

### Dr. Baltar, Vice President — "Commit: Toggle mission alert/reserve"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-119", "BSG1-009"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-119 = Baltar VP. Move mission between alert and reserve
```

### Number Six, Agent Provocateur — "Commit+Sacrifice: 2 extra actions"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: ["BSG1-098", "BSG1-099"], alert: ["BSG1-130"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-130 = Six Agent Provocateur. Use ability, then take 2 extra actions
```

---

## Passive Power Modifiers

### Apollo, Commander Air Group — "All other Pilots +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-099", "BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-099 = Apollo CAG, BSG1-098 = Apollo Ace Pilot (Pilot, power 2 + 1 = 3)
```

### Billy Keikeya, Press Secretary — "While defending, +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-102 = Billy (power 1 + 2 defending = 3). Challenge and opponent defends.
```

### Cylon Centurion — "While challenging, +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-112"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-112 = Cylon Centurion (power 2 + 2 = 4 when challenging)
```

### William Adama, The Old Man — "+2 with another alert personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-143", "BSG1-098"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-143 = Adama Old Man (power 2 + 2 = 4)
```

### D'Anna, Reporter — "Cannot challenge"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-114"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-114 = D'Anna Reporter. No challenge actions should appear.
```

### Starbuck, Hotshot Pilot — "+1 power per other Pilot"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-136", "BSG1-098", "BSG1-099"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG1-136 = Starbuck Hotshot (power 2 + 2 Pilots = 4)
```

### Anders, Resistance Leader — "All other Civilians +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-084", "BSG1-117"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG2-084 = Anders Leader, BSG1-117 = Baltar Award Winner (Civilian, 1+1=2)
```

### Boomer, Human-Lover — "+1 with alert Helo"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-088", "BSG1-122"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102"],
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
// BSG2-088 = Boomer Human-Lover (2 + 1 Helo buff = 3)
```

### Hadrian, Master-At-Arms — "Fleet defense level +1"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-112"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Fleet defense should be base powers + 1
```

---

## Triggered Abilities — Enter Play

### Billy Keikeya, Presidential Aide — "ETB: Gain 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: ["BSG1-101"], alert: [], influence: 10 },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Play Billy from hand — should gain 1 influence
```

### Boomer, Raptor Pilot — "ETB: Draw a card"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-104"],
      alert: [],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Play Boomer — should draw a card
```

### Tom Zarek, Political Prisoner — "ETB: Defeat target personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: ["BSG1-139"], alert: [] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Play Zarek — choose a personnel to defeat
```

---

## Special / Cylon Phase Abilities

### Mr. Gaeta, Brilliant Officer — "Commit: Target cylon threat -1"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-119", "BSG1-103"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG2-119 = Gaeta Brilliant, BSG1-103 = Boomer (has cylon threat). Reduce threat by 1.
```

---

## Card ID Quick Reference

| ID       | Card                              | Type      | Key Traits          |
| -------- | --------------------------------- | --------- | ------------------- |
| BSG1-098 | Apollo, Ace Pilot                 | Personnel | Pilot, Scramble     |
| BSG1-099 | Apollo, Commander Air Group       | Personnel | Pilot               |
| BSG1-100 | Apollo, Political Liaison         | Personnel | Officer, Politician |
| BSG1-101 | Billy Keikeya, Presidential Aide  | Personnel | Politician          |
| BSG1-102 | Billy Keikeya, Press Secretary    | Personnel | Politician          |
| BSG1-103 | Boomer, Hell Of A Pilot           | Personnel | Pilot, Cylon        |
| BSG1-104 | Boomer, Raptor Pilot              | Personnel | Pilot, Cylon        |
| BSG1-105 | Boomer, Saboteur                  | Personnel | Pilot, Cylon        |
| BSG1-110 | Crashdown, Expert ECO             | Personnel | Officer             |
| BSG1-111 | Crashdown, Sensor Operator        | Personnel | Officer             |
| BSG1-112 | Cylon Centurion                   | Personnel | Cylon, Machine      |
| BSG1-113 | D'Anna Biers, Fleet News Service  | Personnel | Civilian, Cylon     |
| BSG1-114 | D'Anna Biers, Reporter            | Personnel | Civilian, Cylon     |
| BSG1-115 | Dee, Dradis Operator              | Personnel | Enlisted            |
| BSG1-117 | Dr. Baltar, Award Winner          | Personnel | Civilian            |
| BSG1-118 | Dr. Baltar, Science Advisor       | Personnel | Civilian            |
| BSG1-119 | Dr. Baltar, Vice President        | Personnel | Politician          |
| BSG1-120 | Galen Tyrol, CPO                  | Personnel | Enlisted            |
| BSG1-122 | Helo, Flight Officer              | Personnel | Officer             |
| BSG1-125 | Laura Roslin, Colonial President  | Personnel | Politician          |
| BSG1-127 | Laura Roslin, Madame President    | Personnel | Politician          |
| BSG1-130 | Number Six, Agent Provocateur     | Personnel | Cylon               |
| BSG1-131 | Number Six, Caprican Operative    | Personnel | Civilian, Cylon     |
| BSG1-132 | Number Six, Secret Companion      | Personnel | Cylon               |
| BSG1-136 | Starbuck, Hotshot Pilot           | Personnel | Pilot               |
| BSG1-139 | Tom Zarek, Political Prisoner     | Personnel | Civilian            |
| BSG1-141 | William Adama, Colonial Commander | Personnel | Officer             |
| BSG1-143 | William Adama, The Old Man        | Personnel | Officer             |
| BSG1-144 | Astral Queen, Prison Ship         | Ship      | Civilian            |
| BSG2-084 | Anders, Resistance Leader         | Personnel | Civilian            |
| BSG2-085 | Apollo, Distant Son               | Personnel | Pilot               |
| BSG2-088 | Boomer, Human-Lover               | Personnel | Cylon               |
| BSG2-090 | Cally, Cheerful Mechanic          | Personnel | Enlisted            |
| BSG2-092 | Centurion Harasser                | Personnel | Cylon, Machine      |
| BSG2-093 | Centurion Hunter                  | Personnel | Cylon, Machine      |
| BSG2-097 | Doral, Tour Guide                 | Personnel | Civilian, Cylon     |
| BSG2-098 | Dr. Baltar, Defense Contractor    | Personnel | Civilian            |
| BSG2-100 | Dr. Baltar, Survivor              | Personnel | Civilian            |
| BSG2-101 | Dr. Cottle, Bearer of Bad News    | Personnel | Officer             |
| BSG2-103 | Dr. Cottle, Military Surgeon      | Personnel | Officer             |
| BSG2-105 | Ellen Tigh, Power Behind the XO   | Personnel | Civilian            |
| BSG2-108 | Elosha, Priestess                 | Personnel | Civilian            |
| BSG2-110 | Hadrian, Head of Tribunal         | Personnel | Enlisted            |
| BSG2-111 | Hadrian, Investigator             | Personnel | Enlisted            |
| BSG2-112 | Hadrian, Master-At-Arms           | Personnel | Enlisted            |
| BSG2-113 | Helo, Prisoner of the Cylons      | Personnel | Officer             |
| BSG2-114 | Helo, Protector                   | Personnel | Officer             |
| BSG2-116 | Laura Roslin, Instigator          | Personnel | Politician          |
| BSG2-118 | Leoben, Snake in the Grass        | Personnel | Civilian, Cylon     |
| BSG2-119 | Mr. Gaeta, Brilliant Officer      | Personnel | Officer             |
| BSG2-123 | Saul Tigh, Disciplinarian         | Personnel | Officer             |
| BSG2-126 | Starbuck, Maverick                | Personnel | Pilot               |
| BSG2-127 | Starbuck, Resistance Fighter      | Personnel | Officer             |
| BSG2-128 | Starbuck, Uncooperative Patient   | Personnel | Officer             |
| BSG2-130 | William Adama, Tactician          | Personnel | Officer, Sniper     |
