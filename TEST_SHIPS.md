# Ship Ability Test Scenarios (Browser UI)

Paste any scenario into the browser console via `__bsg_send(...)`.
After loading, use the UI to interact. Check valid actions for available abilities.

---

## Commit Abilities (Execution Phase)

### Space Park — "Commit: Look at top card, may put on bottom"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-173"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Mining Ship — "Commit: Reveal top 2, opponent picks one for bottom"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-159"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
```

### Mining Ship (opponent) — "You pick which goes to bottom"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-102"] },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-159"],
      influence: 10,
      deck: ["BSG1-098", "BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 1,
  },
});
// AI commits Mining Ship on their turn — you choose which of 2 revealed cards goes to bottom
```

### Gideon, Rebellious Transport — "Commit: Commit target ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-150", "BSG1-173"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-174"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use Gideon to commit Space Park or opponent's Supply Freighter
```

### Colonial One, The President's Ship — "Commit: Target player +1 influence"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-139"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Cannot challenge with this ship — only the commit ability is available
```

### Colonial Viper 0205 — "Commit: Target other ship +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-007", hand: [], alert: ["BSG2-140", "BSG1-153"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-174"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use ability on Viper 762, then challenge — also usable during challenge
```

### Raptor 659 — "Commit: Target other ship gains Strafe"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-007", hand: [], alert: ["BSG2-162", "BSG1-173"] },
    player1: { baseId: "BSG1-004", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Grant Strafe to Space Park — it can then challenge as personnel or ship
```

---

## Commit+Exhaust Abilities

### Freighter — "Commit+Exhaust: Cylon card from discard to hand"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-001",
      hand: [],
      alert: ["BSG1-156"],
      discard: ["BSG1-103"],
      deck: ["BSG1-098", "BSG1-099"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-103 (Boomer, Cylon) is pre-loaded in discard — use ability to recover her
```

### Astral Queen, Platform for Revolution — "Commit+Exhaust: Exhaust 2 personnel"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-133", "BSG1-100"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-098", "BSG1-100", "BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Multi-select: check 2 personnel in the modal, then confirm to exhaust both
```

### Refinery Ship — "Commit+Exhaust: Extra action + cost reduction"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-001",
      hand: ["BSG1-098", "BSG1-099"],
      alert: ["BSG2-164"],
      assets: ["BSG1-162"],
    },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Use ability, then play BSG1-098 (logistics 3→2 with reduction).
// Base + 1 asset = 2 logistics — exactly enough with cost reduction, not enough without.
```

---

## Exhaust-Only Abilities

### Doomed Liner — "Exhaust: Return target Cylon unit to hand"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG1-160", "BSG1-103"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-102"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// BSG1-103 = Boomer (Cylon) — bounce her back to hand
```

---

## Mission Lock-down

### Astral Queen, Hitch in the Plan — "Commit: Commit+exhaust target mission"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: { baseId: "BSG1-004", hand: [], alert: ["BSG2-132"] },
    player1: { baseId: "BSG1-007", alert: ["BSG1-056"], influence: 10 },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Lock down opponent's mission
```

---

## Challenge-Phase Abilities

### Colonial Viper 0205 — "During challenge: Target ship +2 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG2-140", "BSG1-153"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-174"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Viper 762, then use Viper 0205 ability during effects round
```

### Cloud 9, Transport Hub — "Commit during challenge: End challenge"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG2-136", "BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1, Billy defends, then player 1 uses Cloud 9 to end the challenge
```

### Cloud 9, Transport Hub (you defend) — "Use Cloud 9 to end challenge"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-136", "BSG1-102"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-098"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 1,
  },
});
// AI challenges with Apollo — defend with Billy, then use Cloud 9 to end the challenge
```

---

## Passive Power Modifiers

### Raptor 816 — "+1 power while defending"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-174"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-170"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Supply Freighter (power 0) — Raptor 816 defends at power 3 (2+1)
```

### Colonial Viper 4267 — "+1 power while defending"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG1-174"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG2-145"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Supply Freighter — Viper 4267 defends at power 3 (2+1)
```

### Captured Raider, Kara's Pet — "+1 power with alert Starbuck"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG2-135", "BSG1-136"],
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
// Challenge with Captured Raider — power 4 (3 base + 1 Starbuck buff)
```

### Cloud 9, Vacation Ship — "All Civilian units +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-137", "BSG1-117"],
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
// Challenge with Civilian — gets +1 from Cloud 9
```

### Colonial One, Admin HQ — "All Politicians +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG2-138", "BSG1-100"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101"],
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
// BSG1-100 = Apollo, Political Liaison (Politician) — challenge with +1 from Colonial One
```

### Galactica, Launch Platform — "All Fighters +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG2-149", "BSG2-145"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-174"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Viper 4267 (Fighter) — gets +1 from Galactica Launch Platform
```

### Astral Queen, Prison Ship — "All defending personnel +1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-144", "BSG1-102"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1, Billy defends — gets +1 from Astral Queen
```

---

## Triggered Abilities

### Colonial Viper 762 — "On challenge: Commit Pilot for +3 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-001",
      hand: [],
      alert: ["BSG1-153", "BSG1-098", "BSG1-103"],
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
// Challenge with Viper 762 — pick which Pilot to commit for +3 power, or decline
// BSG1-098 = Apollo (Pilot), BSG1-103 = Boomer (Pilot)
```

### Scouting Raider — "ETB: Look at top card of target deck"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-171"],
      alert: [],
      assets: [{ id: "BSG1-150", supplyCards: 3 }],
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
// Play Scouting Raider from hand (costs security 5 — base + asset with 3 supply cards covers it)
```

### Skirmishing Raider — "On challenge end: Sacrifice self"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG1-172"],
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
// Challenge — deals damage but sacrifices itself after
```

### Cloud 9, Cruise Ship — "On influence loss: Commit to reduce by 1"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-098"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG1-145"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge player 1 undefended — Cloud 9 auto-triggers to reduce loss
```

### Nuclear-Armed Raider — "On win: Defeat target asset with no supply cards"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: [],
      alert: ["BSG1-158"],
      assets: ["BSG1-162", "BSG1-167"],
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    player1: {
      baseId: "BSG1-007",
      alert: ["BSG2-153"],
      influence: 10,
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 1,
  },
});
// AI challenges with Nuclear-Armed Raider — defend with Luxury Liner (power 1, will lose).
// On win, Raider defeats one of your assets (Passenger Cruiser or Raptor 563).
```

### Nuclear-Armed Raider (you attack) — "Pick asset to defeat"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG2-153"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-158"],
      assets: ["BSG1-162", "BSG1-167"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with Raider (power 2) vs Luxury Liner (power 1) — you win, pick asset to defeat.
```

---

## Cylon-Phase Modifiers

### Galactica, Defender of the Fleet — "All Cylon threats -1 power"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG2-148", "BSG1-157", "BSG1-172", "BSG1-171"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: [],
      deck: ["BSG1-157", "BSG1-103", "BSG1-098"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Threat level 13 (3+3+4+3) > fleet defense 11 (6+5). Pass to reach Cylon phase.
// Galactica Defender reduces all threat power by 1 — look for "(base X)" on threat cards.
```

### Colonial Viper 1104 — "+2 power during Cylon phase"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-001",
      hand: [],
      alert: ["BSG2-142", "BSG1-157", "BSG1-172", "BSG1-171"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-101", "BSG1-102"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: [],
      deck: ["BSG1-157", "BSG1-103", "BSG1-098"],
      influence: 10,
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Threat 13 (3+3+4+3) > fleet 9 (4+5). Pass to Cylon phase.
// Viper 1104 challenges threats at power 4 (2 base + 2 Cylon phase bonus).
```

---

## Freighter Resources

### Supply Freighter — "On resource spend: Commit to generate logistics"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-098", "BSG1-103"],
      alert: ["BSG1-174"],
      assets: ["BSG1-162", "BSG1-167"],
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
// Play BSG1-098 (logistics 3) — 2 logistics assets + Supply Freighter trigger = 3 logistics
// BSG1-103 (logistics 3) also playable with freighter. Select both logistics assets, freighter covers the 3rd.
```

### Ordnance Freighter — "On resource spend: Commit to generate security"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-004",
      hand: ["BSG1-099", "BSG1-105"],
      alert: ["BSG1-161"],
      assets: ["BSG1-147", "BSG1-149"],
      deck: ["BSG1-098", "BSG1-100", "BSG1-101"],
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
// Play BSG1-099 (security 3) — 2 security assets + Ordnance Freighter trigger = 3 security
// BSG1-105 (security 3) also playable with freighter.
```

### Troop Freighter — "On resource spend: Commit to generate persuasion"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: ["BSG1-101", "BSG1-102"],
      alert: ["BSG1-175"],
      assets: ["BSG1-158", "BSG1-165"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-004",
      alert: ["BSG1-100"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Play BSG1-101 (persuasion 3) — 2 persuasion assets + Troop Freighter trigger = 3 persuasion
// BSG1-102 (persuasion 2) also playable — 2 assets alone cover it, no freighter needed (contrast).
```

---

## Special Mechanics

### Raptor 432 — "Flash play from hand to defend against ship"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-007",
      hand: [],
      alert: ["BSG1-174"],
      deck: ["BSG1-098", "BSG1-099", "BSG1-100"],
    },
    player1: {
      baseId: "BSG1-001",
      hand: ["BSG2-161"],
      alert: [],
      assets: ["BSG1-162", "BSG1-167"],
      influence: 10,
      deck: ["BSG1-099", "BSG1-100", "BSG1-101"],
    },
    phase: "execution",
    turn: 3,
    activePlayerIndex: 0,
  },
});
// Challenge with a ship — player 1 flash plays Raptor 432 (logistics 3: base + 2 assets)
```

### Olympic Carrier — "Sacrifice for 2 Cylon mission requirements"

```js
__bsg_send({
  type: "debugSetup",
  scenario: {
    player0: {
      baseId: "BSG1-001",
      hand: [],
      alert: ["BSG2-154", "BSG1-056"],
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
// Accused (Cylon mission) requires 1 Civilian — you have none, but Olympic Carrier covers it.
// Click "Resolve Accused" → select no units → Olympic Carrier auto-sacrifices to meet the requirement.
```

---

## Card ID Quick Reference

| ID       | Card                                  | Type | Traits           |
| -------- | ------------------------------------- | ---- | ---------------- |
| BSG1-144 | Astral Queen, Prison Ship             | Ship | Transport        |
| BSG1-145 | Cloud 9, Cruise Ship                  | Ship | Transport        |
| BSG1-153 | Colonial Viper 762                    | Ship | Fighter          |
| BSG1-156 | Freighter                             | Ship | Transport        |
| BSG1-159 | Mining Ship                           | Ship | Transport        |
| BSG1-160 | Doomed Liner                          | Ship | Cylon, Transport |
| BSG1-161 | Ordnance Freighter                    | Ship | Transport        |
| BSG1-170 | Raptor 816                            | Ship | Scout            |
| BSG1-171 | Scouting Raider                       | Ship | Cylon, Fighter   |
| BSG1-172 | Skirmishing Raider                    | Ship | Cylon, Fighter   |
| BSG1-173 | Space Park                            | Ship | Transport        |
| BSG1-174 | Supply Freighter                      | Ship | Transport        |
| BSG1-175 | Troop Freighter                       | Ship | Transport        |
| BSG2-132 | Astral Queen, Hitch in the Plan       | Ship | Transport        |
| BSG2-133 | Astral Queen, Platform for Revolution | Ship | Transport        |
| BSG2-135 | Captured Raider, Kara's Pet           | Ship | Fighter          |
| BSG2-136 | Cloud 9, Transport Hub                | Ship | Transport        |
| BSG2-137 | Cloud 9, Vacation Ship                | Ship | Transport        |
| BSG2-138 | Colonial One, Admin HQ                | Ship | Transport        |
| BSG2-139 | Colonial One, The President's Ship    | Ship | Transport        |
| BSG2-140 | Colonial Viper 0205                   | Ship | Fighter          |
| BSG2-142 | Colonial Viper 1104                   | Ship | Fighter          |
| BSG2-145 | Colonial Viper 4267                   | Ship | Fighter          |
| BSG2-148 | Galactica, Defender of the Fleet      | Ship | Capital Ship     |
| BSG2-149 | Galactica, Launch Platform            | Ship | Capital Ship     |
| BSG2-150 | Gideon, Rebellious Transport          | Ship | Transport        |
| BSG2-153 | Nuclear-Armed Raider                  | Ship | Cylon, Fighter   |
| BSG2-154 | Olympic Carrier, Trojan Horse         | Ship | Transport        |
| BSG2-161 | Raptor 432                            | Ship | Scout            |
| BSG2-162 | Raptor 659                            | Ship | Scout            |
| BSG2-164 | Refinery Ship                         | Ship | Transport        |
