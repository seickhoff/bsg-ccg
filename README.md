# Battlestar Galactica CCG

> In the Battlestar Galactica Collectible Card Game, you are the commander of one of two Battlestars leading their Fleets to find a new home for the scattered survivors of the Twelve Colonies, or to destroy the human fleet and all its hopes for survival. Through the use of personnel, ships, events, and missions, you vie to be the first to reach 10 victory points.

## About

This is a digital version of the Battlestar Galactica Collectible Card Game that plays in a web browser.

## Tech Stack

- **TypeScript 5** - Type safety
- **Vite** - Build tool and dev server
- **Node.js + WebSocket** - Game server
- **Prettier** - Code formatting

## Getting Started

```bash
# Install dependencies
npm install

# Start client + server
npm run dev

# Build all packages
npm run build

# Format code
npm run format
```

## Project Structure

```
├── shared/              # Types, card database, deck validation
├── server/              # WebSocket game server
└── client/              # Vite client
    ├── src/             # Game UI, deck builder, renderer
    └── public/images/   # Card images
```
