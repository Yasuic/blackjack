# Blackjack Table

A live blackjack table for you and up to 4 friends, played in the browser. You host the table and act as the dealer, send a link, and everyone plays together in real time. Chips are play money only, and there is no rake or fee.

Play here once GitHub Pages is on: **https://yasuic.github.io/blackjack/**

## Do I need a server?

No. The page is hosted for free on GitHub Pages. When you press "Host a new table", your browser runs the game and your friends' browsers connect straight to yours (this uses WebRTC, a browser feature for direct connections, through the free PeerJS service). So:

1. GitHub Pages serves the web page to everyone.
2. Your browser tab holds the table: the shoe, the chips and the rules.
3. Your friends' browsers send their moves to your tab, and your tab sends back what they are allowed to see. The dealer's hole card never leaves your tab until it is turned over.

The one rule: keep your tab open while you play. If you refresh, the page reopens the same table with everyone's chips, and your friends reconnect on their own.

## Turn on GitHub Pages (one time)

1. Open https://github.com/Yasuic/blackjack/settings/pages
2. Under "Build and deployment", set Source to "Deploy from a branch".
3. Set Branch to `main` and folder to `/ (root)`, then press Save.
4. Wait about a minute. The page appears at https://yasuic.github.io/blackjack/

## How to play with friends

1. Open the page, type your name, and press "Host a new table".
2. Press "Copy invite link" and send the link to up to 4 friends (text, WhatsApp, Discord, anything).
3. Each friend opens the link, types a name, presses "Join table", then "Sit here" on an empty seat.
4. If you want to play as well as deal, press "Sit here" on a seat yourself. There are 5 seats.
5. Everyone picks a chip, taps the main bet spot and any side bets, then presses "Ready, deal me in". Cards are dealt as soon as everyone seated is ready (or press "Deal").
6. On your turn, use Hit, Stand, Double, Split or Surrender. On a computer the keys H, S, D, P and R work too.

## What the host can change

The "Dealer controls" panel is on the right of the host's screen.

- Cards: 1, 2, 6 or 8 decks, or "Randomized", which reshuffles the full shoe before every round.
- When to reshuffle: after a chosen share of the shoe is used (20% to 95%), or every N rounds.
- Starting chips, minimum and maximum bet, maximum side bet.
- Dealer hits or stands on soft 17, surrender on or off, auto deal on or off.
- Give or take chips from any player, kick a player, close insurance for slow players, stand for a player who is away, shuffle now.

- Automatic dealer: betting time (the dealer deals on its own when it runs out, keeping last round's bet for anyone who does not change it) and time per move (the dealer stands for a player who runs out of time). Each can be 10 to 60 seconds or off. With both on, the table runs by itself and you can just play.

Settings can be changed between rounds.

## Rules

The table uses classic Las Vegas Strip rules by default (the host can press "Reset to Las Vegas Strip rules" at any time):

- 6 decks, reshuffled when 75% of the shoe is used.
- The dealer hits 16 or less and stands on all 17s, including soft 17 (for example A-6).
- Blackjack pays 3 to 2. Insurance pays 2 to 1.
- The dealer checks for blackjack when showing an ace or a 10.
- Double on any first two cards, including after a split.
- Split up to 4 hands. Split aces get one card each.
- Late surrender: after the dealer checks for blackjack, you can give up your first two cards and get half the bet back (host can turn it off).

## Side bets

Payouts are "to 1": a 10 chip bet that pays 25 to 1 wins 250 and the 10 comes back too.

| Side bet | Wins when | Pays |
| --- | --- | --- |
| Perfect Pairs | Your first two cards are a pair | Same suit 25, same colour 12, mixed 6 |
| 21+3 | Your two cards plus the dealer up card make a poker hand | Suited trips 100, straight flush 40, trips 30, straight 10, flush 5 |
| Lucky Ladies | Your first two cards total 20 | Two Q♥ with dealer blackjack 1000, two Q♥ 200, matched 25, suited 10, any 20 4 |
| Royal Match | Your first two cards are the same suit | Suited K and Q 25, any suited 2.5 |
| Lucky Lucky | Your two cards plus the dealer up card total 19, 20 or 21 | Suited 7-7-7 200, suited 6-7-8 100, 7-7-7 50, 6-7-8 30, suited 21 15, 21 3, 20 2, 19 2 |
| Over 13 | Your first two cards total 14 or more (aces count 1) | 1 |
| Under 13 | Your first two cards total 12 or less (aces count 1) | 1 |
| Dealer Bust | The dealer busts | 8+ cards 250, 7 cards 100, 6 cards 50, 5 cards 9, 4 cards 2, 3 cards 1 |

The "Side bet payouts" button in the game shows the same table.

## If a friend cannot connect

Most home Wi-Fi and phone networks work. Some strict networks (offices, schools, some public Wi-Fi) block direct browser connections. If one friend cannot join, ask them to switch from Wi-Fi to mobile data, or the other way round.

## Files

- `index.html`: the page.
- `css/style.css`: the look of the table and cards.
- `js/game.js`: the blackjack rules, shoe and side bets. Runs only in the host's browser.
- `js/app.js`: the screens and the connection between players.
- `lib/peerjs.min.js`: PeerJS 1.5.5 (MIT licence), the library for browser to browser connections.
- `test/game.test.mjs`: checks for the rules and side bets. Run with `node test/game.test.mjs`.
