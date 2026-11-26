# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/omjunmuse-hue/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/omjunmuse-hue/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that prices every pre-token protocol in the sealed DefiLlama snapshot from the snapshot itself: TVL times its category median market-cap/TVL multiple (learned from the protocols whose tokens already trade), adjusted for 7-day momentum, years live without a token, and chains reached. Ships a ranked board of 200+ protocols, a filterable offline dashboard with a detail view and a concrete farm plan for every row, and three screenshots of the page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rmzz3c2x&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
