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

## 2. Sniper Personnel challenges — Scramble Personnel can cross-type defend

P0 has Starbuck, Sharpshooter (Sniper personnel, power 4) in alert.
P1 has Apollo, Ace Pilot (Scramble personnel, power 2) and Colonial Viper 229 (ship, no keywords, power 2) in alert.

When P0 challenges with the Sniper, P1 should get the accept/decline prompt (Sniper step A).
If P1 accepts, P0 picks the defender. Both the Scramble personnel AND the ship should be eligible defenders (Scramble lets the personnel defend against a personnel challenger cross-type, but it's already same-type here — this is a control test for the Sniper flow).

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      alert: ["BSG1-138"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      influence: 10,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-098", "BSG1-148"],
      deck: ["BSG1-103", "BSG1-104", "BSG1-105", "BSG1-106"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// P0 alert: BSG1-138 = Starbuck, Sharpshooter (Personnel, Sniper, power 4)
// P1 alert: BSG1-098 = Apollo, Ace Pilot (Personnel, Scramble, power 2)
//           BSG1-148 = Colonial Viper 229 (Ship, no keywords, power 2)
//
// Steps:
//   1. P0 challenges with Starbuck (Sniper) → targets P1
//   2. P1 sees sniperAccept prompt: "Accept defense" / "Decline to defend"
//   3. If P1 accepts → P0 picks defender
//      Expected: Apollo (personnel, same-type match) is eligible
//      Expected: Colonial Viper 229 is NOT eligible (ship vs personnel challenger, no Scramble)
//   4. If P1 declines → challenge is undefended, proceed to effects round
```

---

## 3. Sniper Ship challenges — Scramble Personnel defends cross-type

P0 has Colonial Viper 315 (Sniper ship, power 2) in alert.
P1 has Apollo, Ace Pilot (Scramble personnel, power 2) and Apollo, Commander Air Group (personnel, no keywords, power 2) in alert.

When P0 challenges with the Sniper ship, only the Scramble personnel should be eligible to defend (cross-type via Scramble). The non-Scramble personnel should NOT be eligible.

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      alert: ["BSG1-149"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      influence: 10,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-098", "BSG1-099"],
      deck: ["BSG1-103", "BSG1-104", "BSG1-105", "BSG1-106"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// P0 alert: BSG1-149 = Colonial Viper 315 (Ship, Sniper, power 2)
// P1 alert: BSG1-098 = Apollo, Ace Pilot (Personnel, Scramble, power 2)
//           BSG1-099 = Apollo, Commander Air Group (Personnel, no keywords, power 2)
//
// Steps:
//   1. P0 challenges with Viper 315 (Sniper ship) → targets P1
//   2. P1 sees sniperAccept prompt
//   3. If P1 accepts → P0 picks defender
//      Expected: Apollo, Ace Pilot IS eligible (Scramble lets personnel defend vs ship)
//      Expected: Apollo, CAG is NOT eligible (personnel without Scramble can't defend vs ship)
```

---

## 4. Scramble Ship defends against Sniper Personnel

P0 has Starbuck, Sharpshooter (Sniper personnel, power 4) in alert.
P1 has Raptor 689 (Scramble ship, power 2) and Colonial Shuttle (ship, no keywords, power 1) in alert.

When P0 challenges with the Sniper personnel, the Scramble ship should be eligible to defend cross-type. The non-Scramble ship should NOT be eligible.

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      alert: ["BSG1-138"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101", "BSG1-102"],
      influence: 10,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-168", "BSG1-146"],
      deck: ["BSG1-103", "BSG1-104", "BSG1-105", "BSG1-106"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// P0 alert: BSG1-138 = Starbuck, Sharpshooter (Personnel, Sniper, power 4)
// P1 alert: BSG1-168 = Raptor 689 (Ship, Scramble, power 2)
//           BSG1-146 = Colonial Shuttle (Ship, no keywords, power 1)
//
// Steps:
//   1. P0 challenges with Starbuck (Sniper personnel) → targets P1
//   2. P1 sees sniperAccept prompt
//   3. If P1 accepts → P0 picks defender
//      Expected: Raptor 689 IS eligible (Scramble lets ship defend vs personnel)
//      Expected: Colonial Shuttle is NOT eligible (ship without Scramble can't defend vs personnel)
```

---

## 5. Scramble defends against non-Sniper (normal flow, no Sniper)

P0 has Apollo, Commander Air Group (personnel, no keywords, power 2) in alert.
P1 has Apollo, Ace Pilot (Scramble personnel, power 2) and Raptor 689 (Scramble ship, power 2) in alert.

Normal challenge (no Sniper) — P1 picks their own defender. The Scramble personnel is same-type (always eligible). The Scramble ship should also be eligible cross-type. P1 also sees "Decline to defend" option.

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      alert: ["BSG1-099"],
      deck: ["BSG1-100", "BSG1-101", "BSG1-102", "BSG1-103"],
      influence: 10,
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-098", "BSG1-168"],
      deck: ["BSG1-104", "BSG1-105", "BSG1-106", "BSG1-138"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// P0 alert: BSG1-099 = Apollo, Commander Air Group (Personnel, no keywords, power 2)
// P1 alert: BSG1-098 = Apollo, Ace Pilot (Personnel, Scramble, power 2)
//           BSG1-168 = Raptor 689 (Ship, Scramble, power 2)
//
// Steps:
//   1. P0 challenges with Apollo, CAG (normal personnel) → targets P1
//   2. P1 picks defender (no Sniper, so defending player picks)
//      Expected: Apollo, Ace Pilot IS eligible (same-type personnel vs personnel)
//      Expected: Raptor 689 IS eligible (Scramble lets ship defend vs personnel)
//      Expected: "Decline to defend" option IS present (normal flow)
```

---

## 6. Cylon Challenge — Abilities usable during effects round

P0 has Galactica base (BSG1-007), Apollo Ace Pilot and Crashdown Expert ECO in alert.
P1 has Centurion Ambusher (BSG1-106) and Dr. Cottle (BSG2-101) to oppose the challenger.
Cylon threat level exceeds fleet defense, triggering an attack.
P0 challenges a Cylon threat with Apollo, uses abilities during the effects round.
P1 (the "Cylon player") then uses abilities to help the threat and hurt the challenger.

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      alert: ["BSG1-098", "BSG1-110", "BSG1-103", "BSG1-099", "BSG1-101"],
      hand: [],
      deck: ["BSG1-102", "BSG1-117", "BSG1-118", "BSG1-119"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-100", "BSG1-103", "BSG1-099", "BSG1-106", "BSG2-101"],
      deck: ["BSG1-101", "BSG1-102", "BSG1-117", "BSG1-118"],
    },
    phase: "cylon",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// P0 alert: BSG1-098 = Apollo, Ace Pilot (power 2, threat 2)
//           BSG1-110 = Crashdown, Expert ECO (power 1, threat 2, abilityId: crashdown-buff)
//           BSG1-103 = Boomer, Hell Of A Pilot (Cylon, threat 2)
//           BSG1-099 = Apollo, CAG (threat 1)
//           BSG1-101 = Billy, Presidential Aide (threat 0)
// P1 alert: BSG1-100 = Apollo, Political Liaison (threat 0)
//           BSG1-103 = Boomer (threat 2), BSG1-099 = Apollo CAG (threat 1)
//           BSG1-106 = Centurion Ambusher (power 3, threat 3, abilityId: centurion-ambush)
//           BSG2-101 = Dr. Cottle, Bearer of Bad News (power 1, threat 1, abilityId: cottle-debuff)
// Threat level = P0(2+2+2+1+0) + P1(0+2+1+3+1) = 7+7 = 14 > fleet defense 12 → attack
//
// Steps:
//   1. Cylon phase begins, 2 threats revealed from each player's deck top
//   2. P0 sends a unit (e.g. Apollo, Ace Pilot) to challenge a Cylon threat
//   3. Challenge enters step 2 (effects round) — P0 is active
//   4. P0 sees Crashdown's commit ability and Galactica base exhaust ability
//   5. P0 exhausts Galactica base during the Cylon challenge
//   6. P0 passes — turn advances to P1 (the "Cylon player")
//   7. P1 uses Centurion Ambusher: target Cylon threat gets +2 power (making it harder)
//   8. P1 uses Dr. Cottle: target challenger (Apollo) gets -2 power (weakening challenger)
//   9. Both pass, challenge resolves
//
// Verifies: opponent (Cylon player) can play abilities to help the threat / hurt the challenger.
// Previously broken: base abilities were missing "cylon-challenge" from usableIn arrays.
```

---

## Card ID Quick Reference

| ID       | Card                      | Type      | Keywords | Traits         | Power | Cylon Threat |
| -------- | ------------------------- | --------- | -------- | -------------- | ----- | ------------ |
| BSG1-098 | Apollo, Ace Pilot         | Personnel | Scramble | Pilot          | 2     | 2            |
| BSG1-099 | Apollo, Commander Air Grp | Personnel | —        | Pilot          | 2     | 1            |
| BSG1-100 | Apollo, Political Liaison | Personnel | —        | —              | 2     | 0            |
| BSG1-103 | Boomer, Hell Of A Pilot   | Personnel | —        | Cylon, Pilot   | 2     | 2            |
| BSG1-105 | Boomer, Saboteur          | Personnel | —        | Cylon, Pilot   | 4     | 4            |
| BSG1-106 | Centurion Ambusher        | Personnel | —        | Cylon, Machine | 2     | 3            |
| BSG1-110 | Crashdown, Expert ECO     | Personnel | —        | Officer        | 1     | 2            |
| BSG1-108 | Centurion Slayer          | Personnel | Sniper   | Cylon, Machine | 2     | 2            |
| BSG1-138 | Starbuck, Sharpshooter    | Personnel | Sniper   | Officer        | 4     | 3            |
| BSG1-146 | Colonial Shuttle          | Ship      | —        | Transport      | 1     | 0            |
| BSG1-148 | Colonial Viper 229        | Ship      | —        | Fighter        | 2     | 2            |
| BSG1-149 | Colonial Viper 315        | Ship      | Sniper   | Fighter        | 2     | 3            |
| BSG1-157 | Hunting Raider            | Ship      | —        | Cylon, Fighter | 3     | 3            |
| BSG1-168 | Raptor 689                | Ship      | Scramble | Scout          | 2     | 2            |

## Base ID Quick Reference

| ID       | Base         | Power |
| -------- | ------------ | ----- |
| BSG1-004 | Colonial One | 5     |
| BSG1-007 | Galactica    | 6     |
