#!/usr/bin/env python3
"""Dal risparmio individuato nell'analisi delle spese a un messaggio illustrativo con
collegamento alla chat.

I conti li fa questo codice, mai il modello. I rendimenti vengono da rendimenti.json
(Italia: COVIP, rendimenti medi a 10 anni; Regno Unito: tassi di proiezione FCA) e si
mostrano sempre come intervallo, con l'avvertenza. Nessuna dipendenza esterna.

Uso da codice:
    from proiezione import suggerimento
    s = suggerimento(30, "base", "it")          # 30 euro al mese
    s["messaggio"], s["domanda_chat"], s["avvertenza"]

Prova:  python3 proiezione.py
"""
from __future__ import annotations

import json
from pathlib import Path

QUI = Path(__file__).resolve().parent
TABELLA = json.loads((QUI / "rendimenti.json").read_text(encoding="utf-8"))
LIVELLI = ("base", "intermediate", "advanced")


def valore_finale(mensile: float, tasso_annuo_pct: float, anni: int) -> float:
    """Versamenti mensili costanti con capitalizzazione mensile."""
    r = tasso_annuo_pct / 100 / 12
    n = 12 * anni
    return mensile * n if r == 0 else mensile * ((1 + r) ** n - 1) / r


def _formato(x: float, lingua: str) -> str:
    s = f"{round(x):,}"
    return s.replace(",", ".") if lingua == "it" else s


def suggerimento(risparmio_mensile: float, livello: str, lingua: str = "it", anni: int = 10) -> dict:
    if lingua not in ("it", "en") or livello not in LIVELLI:
        raise ValueError("lingua deve essere it/en e livello base/intermediate/advanced")
    if risparmio_mensile <= 0:
        raise ValueError("il risparmio mensile deve essere positivo")
    riga = TABELLA[lingua]["livelli"][livello]
    versato = risparmio_mensile * 12 * anni
    vmin = valore_finale(risparmio_mensile, riga["rendimento_min"], anni)
    vmax = valore_finale(risparmio_mensile, riga["rendimento_max"], anni)
    f = lambda x: _formato(x, lingua)
    tassi = (f"{riga['rendimento_min']:g}%" if riga["rendimento_min"] == riga["rendimento_max"]
             else f"{riga['rendimento_min']:g}%-{riga['rendimento_max']:g}%").replace(".", "," if lingua == "it" else ".")
    importi = f(vmin) if round(vmin) == round(vmax) else f"{f(vmin)} - {f(vmax)}"
    if lingua == "it":
        messaggio = (f"Se risparmi {f(risparmio_mensile)} € al mese, in {anni} anni metti da parte {f(versato)} €. "
                     f"Investiti in {riga['strumento']}, con un rendimento medio annuo passato {'pari a' if '-' not in tassi else 'compreso tra'} {tassi.replace('-', ' e ')}, "
                     f"potrebbero diventare circa {importi} €.")
        collegamento = f"Per approfondire: {riga['domanda_chat']}"
    else:
        messaggio = (f"If you save £{f(risparmio_mensile)} a month, in {anni} years you will have put aside £{f(versato)}. "
                     f"Invested in {riga['strumento']}, at an assumed {tassi} a year, "
                     f"it could grow to about £{importi}.")
        collegamento = f"Find out more: {riga['domanda_chat']}"
    return dict(messaggio=messaggio, collegamento=collegamento, domanda_chat=riga["domanda_chat"],
                avvertenza=TABELLA["avvertenza"][lingua], fonte=TABELLA[lingua]["fonte"], url_fonte=TABELLA[lingua]["url"],
                numeri=dict(versato=round(versato, 2), valore_min=round(vmin, 2), valore_max=round(vmax, 2),
                            rendimento_min=riga["rendimento_min"], rendimento_max=riga["rendimento_max"], anni=anni))


if __name__ == "__main__":
    for mensile, livello, lingua in ((30, "base", "it"), (50, "intermediate", "it"), (100, "advanced", "it"),
                                     (30, "base", "en"), (50, "intermediate", "en"), (100, "advanced", "en")):
        s = suggerimento(mensile, livello, lingua)
        print(f"[{lingua} {livello}] {s['messaggio']}\n   {s['collegamento']}\n")
    assert round(valore_finale(100, 0, 10)) == 12000
    assert abs(valore_finale(100, 12, 1) - 1268.25) < 0.01
    print("controlli della formula: ok")
