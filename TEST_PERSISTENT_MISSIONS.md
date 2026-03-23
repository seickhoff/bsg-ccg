# Persistent Mission Test Scenarios (Browser UI)

Paste any scenario into the browser console via `__bsg_send(...)`.
After resolving the mission, verify the persistent effect and thumbnail rendering in the resource row.

---

## Passive Power Buffs

### BSG1-061 CAG — "All ships you control get +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-100", "BSG1-061", "BSG1-144"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Officer — Apollo Political Liaison (BSG1-100) satisfies
// BSG1-144 = Astral Queen (Ship, power 1 -> should show 2 after resolve)
// Verify: mission thumbnail in resource row, Astral Queen power badge = 2
```

### BSG1-075 Increased Loadout — "All Fighters get +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-100", "BSG1-098", "BSG1-075", "BSG1-147"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Officer + 1 Pilot — Apollo PL (Officer) + Apollo Ace (Pilot)
// BSG1-147 = Colonial Viper (Fighter ship, power 2 -> should show 3)
// BSG1-144 = Astral Queen is NOT a Fighter, would NOT be buffed
```

### BSG1-093 Stern Leadership — "All Pilots get +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-100", "BSG1-098", "BSG1-093"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Officer + 1 Pilot — Apollo PL (Officer) + Apollo Ace (Pilot)
// Apollo Ace Pilot (power 2 -> should show 3 after resolve)
```

### BSG2-049 Caprican Ideals — "All Civilian units get +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-117", "BSG1-119", "BSG2-049"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Civilian + 1 Politician — Baltar Award Winner (Civilian) + Baltar VP (Politician)
// BSG1-117 = Dr. Baltar Award Winner (Civilian, power 1 -> should show 2)
```

---

## Fleet Defense Modifiers

### BSG1-085 Persistent Assault — "Fleet defense level gets -2"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-103", "BSG1-104", "BSG1-085"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 2 Cylon units — Boomer Hell Of A Pilot (BSG1-103) + Boomer Raptor Pilot (BSG1-104)
// Fleet defense should drop by 2 after resolve (check header bar)
```

### BSG2-052 Coming Out To Fight — "Fleet defense level gets +4"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-144", "BSG1-147", "BSG2-052"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 2 ships — Astral Queen + Colonial Viper
// Fleet defense should increase by 4 after resolve (check header bar)
```

---

## Keyword Grants

### BSG2-073 Ram The Ship — "All ships you control gain Scramble"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-144", "BSG1-147", "BSG2-073", "BSG1-098", "BSG1-100", "BSG1-103"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 3 ships — Astral Queen + Colonial Viper + ... (need 3 ships, may need to adjust)
// After resolve: ships should show Scramble keyword badge
// Verify: opponent challenges with personnel, your ship can defend
```

### BSG2-075 Sam Battery — "All personnel you control gain Scramble"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098", "BSG1-100", "BSG1-103", "BSG2-075"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-144"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 3 personnel — Apollo Ace + Apollo PL + Boomer
// After resolve: personnel should show Scramble keyword badge
// Verify: opponent challenges with ship, your personnel can defend
```

---

## Defeat Interception

### BSG1-068 Flight School — "When ship defeated, sacrifice this instead"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-100", "BSG1-098", "BSG1-068", "BSG1-144"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
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
// Resolve: 1 Officer + 1 Pilot — Apollo PL + Apollo Ace
// Then challenge opponent's Viper with your Astral Queen (weaker ship, expect to lose)
// Flight School should sacrifice itself to save Astral Queen from defeat
```

### BSG1-081 Misdirection — "When personnel defeated, sacrifice this instead"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-117", "BSG1-100", "BSG1-081"],
      deck: ["BSG1-099", "BSG1-101", "BSG1-102"],
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
// Resolve: 1 Civilian + 1 Officer — Baltar Award Winner + Apollo PL
// Then challenge with weaker personnel, expect to lose
// Misdirection should sacrifice itself to save your personnel from defeat
```

---

## Triggered Abilities

### BSG1-065 Dradis Contact — "Each time you play an event, gain 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-012"],
      alert: ["BSG1-100", "BSG1-144", "BSG1-065"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Officer + 1 ship — Apollo PL + Astral Queen
// Then play an event from hand — should gain 1 influence
// BSG1-012 = Catastrophe (free event, good test card)
```

### BSG1-082 Multiple Contacts — "Each ready phase start, draw a card"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098", "BSG1-144", "BSG1-082"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 personnel + 1 ship — Apollo Ace + Astral Queen
// Pass to end execution, survive cylon phase, then in ready phase should draw 3 (2 normal + 1 extra)
```

---

## Resolve-Time Effects

### BSG1-063 Combat Air Patrol — "Commit target Pilot, gain 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098", "BSG1-144", "BSG1-063"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 1 Pilot + 1 ship — Apollo Ace (Pilot) + Astral Queen
// Should prompt to commit a Pilot, then gain 1 influence
// Mission stays in play (persistent)
```

### BSG1-064 Difference Of Opinion — "Can't challenge you unless they pay 1 resource"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-100", "BSG1-122", "BSG1-064"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-098"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Resolve: 2 Officers — Apollo PL (Officer) + Helo Flight Officer (Officer)
// After resolve, pass. Opponent should need to pay 1 resource to challenge you.
```

---

## Card ID Quick Reference

| ID       | Card                              | Type      | Key Traits          |
| -------- | --------------------------------- | --------- | ------------------- |
| BSG1-098 | Apollo, Ace Pilot                 | Personnel | Pilot, Scramble     |
| BSG1-100 | Apollo, Political Liaison         | Personnel | Officer, Politician |
| BSG1-102 | Billy Keikeya, Press Secretary    | Personnel | Politician          |
| BSG1-103 | Boomer, Hell Of A Pilot           | Personnel | Pilot, Cylon        |
| BSG1-104 | Boomer, Raptor Pilot              | Personnel | Pilot, Cylon        |
| BSG1-117 | Dr. Baltar, Award Winner          | Personnel | Civilian            |
| BSG1-119 | Dr. Baltar, Vice President        | Personnel | Politician          |
| BSG1-122 | Helo, Flight Officer              | Personnel | Officer             |
| BSG1-141 | William Adama, Colonial Commander | Personnel | Officer             |
| BSG1-144 | Astral Queen, Prison Ship         | Ship      | Civilian            |
| BSG1-147 | Colonial Viper                    | Ship      | Fighter             |

| ID       | Mission               | Resolve Requirement       | Persistent Effect                       |
| -------- | --------------------- | ------------------------- | --------------------------------------- |
| BSG1-061 | CAG                   | 1 Officer                 | All ships +1 power                      |
| BSG1-063 | Combat Air Patrol     | 1 Pilot + 1 ship          | Commit Pilot, gain 1 influence          |
| BSG1-064 | Difference Of Opinion | 2 Officers                | Challenge cost +1 resource              |
| BSG1-065 | Dradis Contact        | 1 Officer + 1 ship        | Event play -> gain 1 influence          |
| BSG1-068 | Flight School         | 1 Officer + 1 Pilot       | Sacrifice to save ship from defeat      |
| BSG1-075 | Increased Loadout     | 1 Officer + 1 Pilot       | All Fighters +1 power                   |
| BSG1-081 | Misdirection          | 1 Civilian + 1 Officer    | Sacrifice to save personnel from defeat |
| BSG1-082 | Multiple Contacts     | 1 personnel + 1 ship      | Ready phase: draw extra card            |
| BSG1-085 | Persistent Assault    | 2 Cylon units             | Fleet defense -2                        |
| BSG1-093 | Stern Leadership      | 1 Officer + 1 Pilot       | All Pilots +1 power                     |
| BSG2-049 | Caprican Ideals       | 1 Civilian + 1 Politician | All Civilians +1 power                  |
| BSG2-052 | Coming Out To Fight   | 2 ships                   | Fleet defense +4                        |
| BSG2-073 | Ram The Ship          | 3 ships                   | All ships gain Scramble                 |
| BSG2-075 | Sam Battery           | 3 personnel               | All personnel gain Scramble             |
