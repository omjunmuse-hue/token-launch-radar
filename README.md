# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/omjunmuse-hue/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/omjunmuse-hue/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that prices every pre-token protocol in the sealed DefiLlama snapshot from the snapshot itself — version 2, rebuilt around blind tests. Value if launched comes from a log-log pricing line fitted on the 128 peers whose tokens carry a real price; launch odds come from a logistic launch curve fitted on every dated protocol and falling with age; the board ranks by expected value (the two multiplied), with each row's backtest range and farm verdict. Every candidate term — category multiples, momentum, chain and age tilts, nearest neighbours — was fitted and tested leave-one-out and walk-forward inside the program itself, and only the winners move a price; the scores ship in the dossier and on the dashboard's method page. Ships a ranked board of 243 protocols with an integrity strip accounting for all 758, a filterable offline dashboard with a detail view and a concrete, costed farm plan for every row, and three screenshots of the page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rmzz3c2x&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
