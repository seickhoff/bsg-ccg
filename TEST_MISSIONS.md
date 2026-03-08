# Mission Ability Test Scenarios (Browser UI)

Paste any scenario into the browser console via `__bsg_send(...)`.
After loading, use the UI to interact. Missions appear in alert zone — resolve them via the action panel.

---

## Card ID Quick Reference

| ID       | Name                  | Traits    | Resolve Req               | Category        |
| -------- | --------------------- | --------- | ------------------------- | --------------- |
| BSG1-056 | Accused               | Cylon     | 1 Civilian unit           | one-shot        |
| BSG1-057 | Alert Five            | Military  | 1 Officer                 | one-shot        |
| BSG1-058 | Arrow Of Apollo       | Political | 1 Pilot + 1 ship          | one-shot        |
| BSG1-059 | Article 23            | Political | 1 Officer                 | one-shot        |
| BSG1-060 | Based On Scriptures   | Political | 3 Politicians             | one-shot        |
| BSG1-061 | CAG                   | Military  | 1 Officer                 | persistent      |
| BSG1-062 | Colonial Day          | Political | 1 Civilian + 1 Politician | one-shot        |
| BSG1-063 | Combat Air Patrol     | Military  | 1 Pilot + 1 ship          | persistent      |
| BSG1-064 | Difference Of Opinion | Military  | 2 Officers                | persistent      |
| BSG1-065 | Dradis Contact        | Military  | 1 Officer + 1 ship        | persistent      |
| BSG1-066 | Earn Freedom Points   | Civilian  | 1 Officer + 1 Politician  | one-shot        |
| BSG1-067 | Earn Your Wings       | Military  | 1 Officer + 1 Pilot       | one-shot        |
| BSG1-068 | Flight School         | Military  | 1 Officer + 1 Pilot       | persistent      |
| BSG1-069 | Formal Dress Function | Political | 2 Politicians             | one-shot        |
| BSG1-070 | Full Scale Assault    | Military  | 1 Officer + 1 ship        | one-shot        |
| BSG1-071 | God Has A Plan        | Cylon     | 2 Cylon units             | persistent      |
| BSG1-072 | Green: Normal Human   | Civilian  | 1 Civilian unit           | one-shot        |
| BSG1-073 | Hand Of God           | —         | 1 Politician              | one-shot        |
| BSG1-074 | Hunt For Tylium       | —         | 1 ship                    | one-shot        |
| BSG1-075 | Increased Loadout     | Military  | 1 Officer + 1 Pilot       | persistent      |
| BSG1-076 | Interim Quorum        | Political | 1 Politician + 1 ship     | persistent      |
| BSG1-077 | Investigation         | —         | 2 Officers                | one-shot        |
| BSG1-078 | Kobol's Last Gleaming | —         | 1 Officer + 1 Pilot       | one-shot        |
| BSG1-079 | Life Has A Melody     | —         | 1 Civilian + 1 Cylon unit | one-shot        |
| BSG1-080 | Meet The New Boss     | —         | 1 Civilian + 1 Officer    | one-shot        |
| BSG1-081 | Misdirection          | —         | 1 Civilian + 1 Officer    | persistent      |
| BSG1-082 | Multiple Contacts     | —         | 1 personnel + 1 ship      | persistent      |
| BSG1-083 | Obliterate The Base   | —         | 1 Pilot + 1 ship          | one-shot        |
| BSG1-084 | Overtime              | —         | 2 personnel               | one-shot        |
| BSG1-085 | Persistent Assault    | Cylon     | 2 Cylon units             | persistent      |
| BSG1-086 | Picking Sides         | —         | 2 personnel               | one-shot        |
| BSG1-087 | Press Junket          | —         | 1 ship                    | one-shot        |
| BSG1-088 | Pulling Rank          | Military  | 1 Officer                 | one-shot        |
| BSG1-089 | Red: Evil Cylon       | Civilian  | 1 Civilian unit           | one-shot        |
| BSG1-090 | Refueling Operation   | Military  | 2 Pilots + 2 ships        | one-shot        |
| BSG1-091 | Relieved Of Duty      | Political | 1 Officer                 | one-shot        |
| BSG1-092 | Shuttle Diplomacy     | Political | 1 personnel + 1 ship      | one-shot        |
| BSG1-093 | Stern Leadership      | Military  | 1 Officer + 1 Pilot       | persistent      |
| BSG1-094 | Suspicions            | Military  | 1 Civilian + 1 Officer    | one-shot        |
| BSG1-095 | Trying Times          | Political | 2 Politicians             | one-shot        |
| BSG1-096 | We'll See You Again   | —         | 2 Cylon units             | persistent      |
| BSG1-097 | Working Together      | Political | 1 Officer + 1 Politician  | one-shot        |
| BSG2-045 | Are You Alive?        | Cylon     | 1 Cylon personnel         | link(Personnel) |
| BSG2-048 | Blackmail             | Political | 2 personnel               | link(Personnel) |
| BSG2-050 | Caprican Supplies     | —         | 2 personnel               | link(Personnel) |
| BSG2-052 | Coming Out To Fight   | Military  | 2 ships                   | persistent      |
| BSG2-054 | Cutting Through Hull  | Military  | 1 Officer + 1 ship        | link(Unit)      |
| BSG2-055 | Cylon Ambush          | Cylon     | 2 Cylon units             | persistent      |
| BSG2-057 | Damning Evidence      | Cylon     | 1 Cylon personnel         | link(Personnel) |
| BSG2-058 | Deck Crew             | Military  | 1 Enlisted                | link(Ship)      |
| BSG2-060 | Explosive Rounds      | Military  | 1 Enlisted + 1 Officer    | link(Unit)      |
| BSG2-065 | Instant Acclaim       | Political | 1 Civilian + 1 Politician | link(Unit)      |
| BSG2-067 | Marine Assault        | Military  | 1 Officer                 | link(Ship)      |
| BSG2-068 | Mysterious Warning    | —         | 2 personnel               | link(Personnel) |
| BSG2-072 | Raider Swarm          | Cylon     | 2 Cylon ships             | link(Ship)      |
| BSG2-073 | Ram The Ship          | Military  | 3 ships                   | persistent      |
| BSG2-075 | Sam Battery           | Military  | 3 personnel               | persistent      |
| BSG2-076 | Teamwork              | Military  | 2 ships                   | link(Ship)      |
| BSG2-080 | To Your Ships         | Military  | 1 Officer + 1 Pilot       | link(Personnel) |
| BSG2-082 | Viral Warfare         | Cylon     | 2 Cylon units             | link(Ship)      |

### Common Unit Cards for Tests

| ID       | Name                             | Type      | Power | Traits        |
| -------- | -------------------------------- | --------- | ----- | ------------- |
| BSG1-098 | Apollo, Ace Pilot                | Personnel | 2     | Pilot         |
| BSG1-109 | Crashdown                        | Personnel | 1     | Officer       |
| BSG1-117 | Dr. Baltar, Award Winner         | Personnel | 1     | Civilian      |
| BSG1-130 | Number Six, Agent Provocateur    | Personnel | 0     | Cylon         |
| BSG1-140 | Tom Zarek, Sagittaron Rep        | Personnel | 2     | Politician    |
| BSG1-143 | William Adama, The Old Man       | Personnel | 2     | Officer       |
| BSG1-115 | Dee, Dradis Operator             | Personnel | 1     | Enlisted      |
| BSG1-101 | Billy Keikeya, Presidential Aide | Personnel | 2     | Politician    |
| BSG1-103 | Boomer, Hell Of A Pilot          | Personnel | 2     | Cylon+Pilot   |
| BSG1-147 | Colonial Viper 113               | Ship      | 2     | Fighter       |
| BSG1-148 | Colonial Viper 229               | Ship      | 2     | Fighter       |
| BSG1-157 | Hunting Raider                   | Ship      | 4     | Cylon+Fighter |
| BSG2-152 | Menacing Raider                  | Ship      | 3     | Cylon+Fighter |

---

## One-Shot Missions: Simple Effects

### Based On Scriptures — "Gain 5 influence" (3 Politicians)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-060", "BSG1-140", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → gain 5 influence
```

### Hand Of God — "Draw 2 cards" (1 Politician)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-073", "BSG1-140"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → draw 2 cards to hand
```

### Press Junket — "Gain 2 influence" (1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-087", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Shuttle Diplomacy — "Gain 3 influence" (1 personnel + 1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-092", "BSG1-140", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Suspicions — "Target player loses 2 influence" (1 Civilian + 1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-094", "BSG1-117", "BSG1-109"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → opponent loses 2 influence
```

---

## One-Shot Missions: Unit Movement

### Alert Five — "Ready all Fighters" (1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-057", "BSG1-109"],
      reserve: ["BSG1-147", "BSG1-148"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Vipers move from reserve to alert
```

### Earn Your Wings — "Ready all Pilots" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-067", "BSG1-109", "BSG1-098"],
      reserve: ["BSG1-103"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Boomer readied from reserve to alert
```

### Overtime — "Ready all ships you control" (2 personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-084", "BSG1-109", "BSG1-098"],
      reserve: ["BSG1-147", "BSG1-148"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → both ships move from reserve to alert
```

### Formal Dress Function — "Commit all Officers" (2 Politicians)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-069", "BSG1-140", "BSG1-101", "BSG1-109"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-109"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → all Officers (both players) committed to reserve
```

### Working Together — "Ready all Politicians" (1 Officer + 1 Politician)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-097", "BSG1-109", "BSG1-140"],
      reserve: ["BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Billy moves from reserve to alert
```

---

## One-Shot Missions: Targeted Effects

### Relieved Of Duty — "Return alert personnel to hand" (1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-091", "BSG1-109"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → choose target → personnel returned to hand
```

### Investigation — "Personnel to top of deck + lose 2 influence" (2 Officers)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-077", "BSG1-109", "BSG1-143"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → target put on top of deck, owner loses 2 influence
```

### Kobol's Last Gleaming — "Shuffle personnel into deck" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-078", "BSG1-109", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → target shuffled into owner's deck
```

### Green: Normal Human — "Bounce Cylon, owner gains 2" (1 Civilian)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-072", "BSG1-117"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-130"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Number Six returns to hand, opponent gains 2 influence
```

### Red: Evil Cylon — "Bounce Cylon, owner loses 2" (1 Civilian)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-089", "BSG1-117"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-130"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Number Six returns to hand, opponent loses 2 influence
```

### Accused — "Target gains Cylon trait" (1 Civilian)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-056", "BSG1-117"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → choose target personnel → gains Cylon trait until end of turn
```

### Full Scale Assault — "All your units +1 power" (1 Officer + 1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-070", "BSG1-109", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → all your alert units get +1 power this phase
```

### Obliterate The Base — "Defeat target asset" (1 Pilot + 1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-083", "BSG1-098", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Note: Opponent needs an asset with no supply cards for this to be resolvable
```

---

## One-Shot Missions: Counting Effects

### Trying Times — "Gain 1 per alert Politician" (2 Politicians)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-095", "BSG1-140", "BSG1-101"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → gain 1 influence per alert Politician (all players)
```

### Earn Freedom Points — "1 per Civilian unit/mission" (1 Officer + 1 Politician)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-066", "BSG1-109", "BSG1-140", "BSG1-117"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → gain 1 per Civilian unit you control + Civilian missions
```

---

## Persistent Missions: Power Modifiers

### CAG — "All ships +1 power" (1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-061", "BSG1-109", "BSG1-147", "BSG1-148"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → mission stays in play, ships get +1 power. Challenge to verify.
```

### Stern Leadership — "All Pilots +1 power" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-093", "BSG1-109", "BSG1-098", "BSG1-103"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → persistent, Pilots get +1. Challenge with Apollo/Boomer to verify.
```

### Increased Loadout — "All Fighters +1 power" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-075", "BSG1-109", "BSG1-098", "BSG1-147"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → persistent, Fighters get +1 power
```

---

## Persistent Missions: Fleet Defense & Cylon

### Coming Out To Fight — "Fleet defense +4" (2 ships)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-052", "BSG1-147", "BSG1-148"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → fleet defense level increases by 4
```

### Persistent Assault — "Fleet defense -2" (2 Cylon units)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-085", "BSG1-130", "BSG1-157"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → fleet defense level decreases by 2
```

---

## Persistent Missions: Keyword Grants

### Ram The Ship — "All ships gain Scramble" (3 ships)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-073", "BSG1-147", "BSG1-148", "BSG1-146"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-098"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → all your ships gain Scramble (can defend against personnel)
```

### Sam Battery — "All personnel gain Scramble" (3 personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-075", "BSG1-109", "BSG1-098", "BSG1-140"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-147"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → all your personnel gain Scramble (can defend against ships)
```

---

## Persistent Missions: Defeat Prevention

### Flight School — "Sacrifice to prevent ship defeat" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-068", "BSG1-109", "BSG1-098", "BSG1-147"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-157"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-098", "BSG1-097"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve Flight School first, then let opponent challenge your Viper with Hunting Raider
```

### Misdirection — "Sacrifice to prevent personnel defeat" (1 Civilian + 1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-081", "BSG1-117", "BSG1-109"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-143"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-098", "BSG1-097"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve Misdirection, then let opponent challenge your Crashdown
```

---

## Persistent Missions: Special Rules

### Difference Of Opinion — "Challenge costs 1 resource" (2 Officers)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-064", "BSG1-109", "BSG1-143"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → opponent's challenges now cost 1 resource each
```

### Combat Air Patrol — "Commit Pilot + gain 1" (1 Pilot + 1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-063", "BSG1-098", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → choose a Pilot to commit, gain 1 influence, mission stays persistent
```

### We'll See You Again — "Cylon units not singular" (2 Cylon units)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-096", "BSG1-130", "BSG1-157"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → Cylon units no longer overlay (singular rule bypassed)
```

---

## Link Missions: Passive Modifiers

### Caprican Supplies — "Link Personnel: +1 power" (2 personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-050", "BSG1-109", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → choose personnel to attach → that personnel gets +1 power
```

### Deck Crew — "Link Ship: +1 power" (1 Enlisted)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-058", "BSG1-115", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to Viper → +1 power
```

### Instant Acclaim — "Link Unit: +1 power" (1 Civilian + 1 Politician)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-065", "BSG1-117", "BSG1-140"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to any unit → +1 power
```

---

## Link Missions: Keyword Grants

### Blackmail — "Personnel gains Manipulate" (2 personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-048", "BSG1-109", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to personnel → gains Manipulate keyword
```

### Marine Assault — "Ship gains Scramble" (1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-067", "BSG1-109", "BSG1-147"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-098"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to Viper → gains Scramble (can defend against personnel)
```

### Cutting Through The Hull — "Unit gains Scramble" (1 Officer + 1 ship)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-054", "BSG1-109", "BSG1-098", "BSG1-147"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to any unit → gains Scramble
```

### To Your Ships — "Personnel gains Scramble" (1 Officer + 1 Pilot)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-080", "BSG1-109", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-147"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to personnel → gains Scramble
```

---

## Link Missions: Challenge Restrictions

### Damning Evidence — "Personnel can't challenge" (1 Cylon personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-057", "BSG1-130", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to Apollo → Apollo can no longer challenge (can still defend)
```

### Raider Swarm — "Ship can't challenge" (2 Cylon ships)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-072", "BSG1-157", "BSG2-152"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-147"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to one ship → that ship can't challenge (can defend)
```

---

## Link Missions: Cylon Phase Power

### Explosive Rounds — "+2 power during Cylon phase" (1 Enlisted + 1 Officer)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-060", "BSG1-115", "BSG1-109"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to unit → +2 power only during Cylon phase
```

### Teamwork — "Ship +2 power during Cylon phase" (2 ships)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-076", "BSG1-147", "BSG1-148"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to ship → +2 power in Cylon phase
```

### Mysterious Warning — "Personnel +2 during Cylon phase" (2 personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-068", "BSG1-109", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to personnel → +2 power in Cylon phase
```

---

## Link Missions: Activated Abilities

### Are You Alive? — "Commit: target -2 power" (1 Cylon personnel)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-045", "BSG1-130", "BSG1-098"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-140"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to Apollo → use linked ability: commit Apollo to debuff target
```

### Viral Warfare — "Commit ship: opponent discards" (2 Cylon units)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-082", "BSG1-130", "BSG1-157"] },
    player1: {
      baseId: "BSG1-007",
      hand: ["BSG1-098", "BSG1-099"],
      alert: ["BSG1-102"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve → attach to Hunting Raider → use ability: commit to force discard
```
