# Base Card Ability Test Scenarios

Paste any of these into the browser console to load a debug scenario.
The game will start mid-game in the execution phase with the specified cards in play.

After loading, use the UI buttons to interact — or check `validActions` in the game state responses.

---

## 1. Colonial One — "Target player gains 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-100"], influence: 10 },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use the "Colonial One" ability — pick yourself or opponent as target
```

## 2. Galactica — "Target player loses 1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-007", hand: [], alert: ["BSG1-100"], influence: 10 },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use the "Galactica" ability — target opponent to lose 1 influence
```

## 3. Celestra — "Look at top two cards, put one on top, other on bottom"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-003",
      hand: [],
      alert: ["BSG1-100"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use ability — you'll see a pending choice to pick which card goes on top
```

## 4. Cylon Base Star — "Ready target Cylon unit"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-005", hand: [], alert: ["BSG1-100"], reserve: ["BSG1-103"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-103 = Boomer, Hell Of A Pilot (Cylon trait) in reserve
// Use ability to ready her into alert
```

## 5. Battlestar Galactica — "Target challenging unit gets +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-002", hand: [], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with BSG1-100, then use base ability during the challenge
```

## 6a. Assault Base Star — "Target Cylon unit gets +2 power" (execution phase)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG2-001", hand: [], alert: ["BSG1-103"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-100"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-103 = Boomer (Cylon) — ability available immediately, no challenge needed
```

## 6b. Assault Base Star — "Target Cylon unit gets +2 power" (during challenge)

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG2-001", hand: [], alert: ["BSG1-103"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-100"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with BSG1-103 (Cylon), then use base ability during challenge for +2
```

## 7. BS-75 Galactica — "Target unit challenging Cylon threat gets +3 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG2-003",
      hand: [],
      alert: ["BSG1-100"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-157"],
      deck: ["BSG1-157", "BSG1-098", "BSG1-099"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Requires Cylon phase to trigger — need enough Cylon threat in play
// BSG1-157 = Hunting Raider (Cylon ship, threat 3)
// Pass execution to reach Cylon phase, then challenge a threat and use ability
```

## 8. Delphi Union High School — "Target unit in a challenge gets +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG2-005", hand: [], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with BSG1-100, then use base ability on your challenger for +1
```

## 9. Ragnar Anchorage — "Extra action + generate 3 of any one resource"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG2-006", hand: ["BSG1-098", "BSG1-099"], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use ability — you get an extra action, and your next resource spend generates 3 of one type
```

## 10. Agro Ship — "When challenged, ready target personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-001", alert: ["BSG1-102"], reserve: ["BSG1-101"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1 — they get the Agro Ship trigger to ready BSG1-101 from reserve
// BSG1-101 = Billy Keikeya, Presidential Aide (personnel)
```

## 11. Flattop — "When challenged, ready target ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-006", alert: ["BSG1-102"], reserve: ["BSG1-144"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1 — they get Flattop trigger to ready BSG1-144 from reserve
// BSG1-144 = Astral Queen (ship)
```

## 12. I.H.T. Colonial One — "Reduce influence loss by 2"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-100"] },
    player1: { baseId: "BSG1-008", alert: [], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1 with no defender — they lose influence
// IHT trigger fires automatically to reduce the loss by 2
```

## 13. Blockading Base Star — "Cylon threat text doesn't affect target player"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG2-002",
      hand: [],
      alert: ["BSG1-157"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-157"],
      deck: ["BSG1-103", "BSG1-098", "BSG1-099"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-157 = Hunting Raider (Cylon, threat 3) — two in play = threat 6
// Pass execution to reach Cylon phase — when threats reveal, use Blockading Base Star
```

## 14. Colonial Heavy 798 — "Counts as one Civilian for mission requirements"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG2-004", hand: [], alert: ["BSG1-100", "BSG1-115"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-115 = Civilian personnel
// Resolve a mission that requires Civilians — base counts as one extra Civilian
```

---

## Card ID Quick Reference

| ID       | Card                             | Type      | Traits         |
| -------- | -------------------------------- | --------- | -------------- |
| BSG1-098 | Apollo, Ace Pilot                | Personnel | —              |
| BSG1-099 | Apollo, Commander Air Group      | Personnel | —              |
| BSG1-100 | Apollo, Political Liaison        | Personnel | —              |
| BSG1-101 | Billy Keikeya, Presidential Aide | Personnel | —              |
| BSG1-102 | Billy Keikeya, Press Secretary   | Personnel | —              |
| BSG1-103 | Boomer, Hell Of A Pilot          | Personnel | Cylon          |
| BSG1-115 | —                                | Personnel | Civilian       |
| BSG1-144 | Astral Queen, Prison Ship        | Ship      | —              |
| BSG1-157 | Hunting Raider                   | Ship      | Cylon, Fighter |

## Base ID Quick Reference

| ID       | Base                     | Ability                        |
| -------- | ------------------------ | ------------------------------ |
| BSG1-001 | Agro Ship                | On challenged: ready personnel |
| BSG1-002 | Battlestar Galactica     | Challenger +2 power            |
| BSG1-003 | Celestra                 | Look at top 2, reorder         |
| BSG1-004 | Colonial One             | Target player +1 influence     |
| BSG1-005 | Cylon Base Star          | Ready Cylon unit               |
| BSG1-006 | Flattop                  | On challenged: ready ship      |
| BSG1-007 | Galactica                | Target player -1 influence     |
| BSG1-008 | I.H.T. Colonial One      | Reduce influence loss by 2     |
| BSG2-001 | Assault Base Star        | Cylon unit +2 power            |
| BSG2-002 | Blockading Base Star     | Block Cylon threat text        |
| BSG2-003 | BS-75 Galactica          | +3 vs Cylon threat             |
| BSG2-004 | Colonial Heavy 798       | Counts as Civilian for mission |
| BSG2-005 | Delphi Union High School | Unit in challenge +1 power     |
| BSG2-006 | Ragnar Anchorage         | Extra action + 3 resources     |
