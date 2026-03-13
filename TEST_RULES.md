# Game Rules Test Scenarios

Paste any of these into the browser console to load a debug scenario.
Tests for core game rules (Cylon phase, challenges, etc.) that aren't specific to a single card ability.

---

## 1. Fleet Jump — All Cylon threats have Cylon trait

Tests rule 1a: "If all revealed Cylon threats have the Cylon trait, then the fleet must jump away. Each player chooses and sacrifices an asset or a supply card."

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-157", "BSG1-106"],
      assets: ["BSG1-098"],
      baseSupplyCards: 1,
      deck: ["BSG1-103", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-157", "BSG1-106"],
      assets: ["BSG1-100"],
      deck: ["BSG1-105", "BSG1-104", "BSG1-098", "BSG1-099"],
      influence: 10,
    },
    phase: "cylon",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Alert: BSG1-157 x2 = Hunting Raider (Cylon, threat 3), BSG1-106 x2 = Centurion (Cylon, threat 3)
// Threat level = 3+3+3+3 = 12 > fleet defense 11 (Colonial One 5 + Galactica 6) → attack triggers
// Deck tops (revealed as threats):
//   P0: BSG1-103 = Boomer, Hell Of A Pilot (Cylon trait, threat 2)
//   P1: BSG1-105 = Boomer, Saboteur (Cylon trait, threat 4)
// Both threats have the Cylon trait → fleet must jump!
// Each player gets a sacrifice choice:
//   P0 has: Apollo, Ace Pilot (asset) + 1 supply card under Colonial One
//   P1 has: Apollo, Political Liaison (asset)
// Expected: prompt shows "Fleet Jump — choose an asset or supply card to sacrifice"
// After both players choose, all threats go to discard and Cylon phase ends.
```

---

## Card ID Quick Reference

| ID       | Card                      | Type      | Traits         | Cylon Threat |
| -------- | ------------------------- | --------- | -------------- | ------------ |
| BSG1-098 | Apollo, Ace Pilot         | Personnel | —              | 0            |
| BSG1-100 | Apollo, Political Liaison | Personnel | —              | 0            |
| BSG1-103 | Boomer, Hell Of A Pilot   | Personnel | Cylon, Pilot   | 2            |
| BSG1-105 | Boomer, Saboteur          | Personnel | Cylon, Pilot   | 4            |
| BSG1-106 | Centurion Ambusher        | Personnel | Cylon, Machine | 3            |
| BSG1-157 | Hunting Raider            | Ship      | Cylon, Fighter | 3            |

## Base ID Quick Reference

| ID       | Base         | Power |
| -------- | ------------ | ----- |
| BSG1-004 | Colonial One | 3     |
| BSG1-007 | Galactica    | 4     |
