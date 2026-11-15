"""Connector contract. A new data source = one subclass + catalog entries."""
from dataclasses import dataclass, field, asdict
from typing import Callable

from ..geo import Location

# How a number came to exist. Shown next to every value in the UI.
KIND_MODELLED = "modelled"          # satellite-derived / reanalysis / model output
KIND_REPORTED = "reported"          # official statistic reported by an agency
KIND_SURVEY = "survey_index"        # perception or survey-based composite index
KIND_PROXY = "proxy"                # real statistic standing in for the thing we want
KIND_PREDICTED = "predicted"        # machine-learning prediction (e.g. SoilGrids)
KIND_ESTIMATED = "estimated"        # calculated here from retrieved values with a stated formula


@dataclass
class VariableDef:
    id: str
    label: str
    connector: str
    param: str
    units: str
    kind: str
    resolution: str
    category: str
    description: str = ""
    keywords: list[str] = field(default_factory=list)
    default_direction: str = "higher"   # higher | lower | target
    proxy_note: str | None = None
    pct_meaningful: bool = True         # False for interval scales where % difference is meaningless
    stat: str = "ANN"
    extra: dict = field(default_factory=dict)

    def public(self) -> dict:
        d = asdict(self)
        d.pop("extra", None)
        d.pop("stat", None)
        return d


@dataclass
class Obs:
    value: float | None
    period: str | None = None
    status: str = "ok"                  # ok | missing | error | not_retrieved
    note: str | None = None
    extra: dict = field(default_factory=dict)

    def public(self) -> dict:
        d = {"value": self.value, "period": self.period, "status": self.status}
        if self.note:
            d["note"] = self.note
        if self.extra:
            d.update(self.extra)
        return d


@dataclass
class FetchResult:
    obs: dict[str, dict[str, Obs]] = field(default_factory=dict)   # var_id -> iso3 -> Obs
    points: list[dict] = field(default_factory=list)               # sample points for the map
    units: dict[str, str] = field(default_factory=dict)            # units reported by the API
    labels: dict[str, str] = field(default_factory=dict)           # names reported by the API
    retrieved_at: float | None = None
    source_updated: str | None = None
    period: str | None = None
    errors: list[str] = field(default_factory=list)


Progress = Callable[[str], None]


class Connector:
    id = ""
    name = ""
    url = ""
    license = ""
    notes = ""

    def fetch(self, variables: list[VariableDef], locations: list[Location], progress: Progress,
              points: dict[str, list[tuple[float, float]]] | None = None) -> FetchResult:
        raise NotImplementedError

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "url": self.url, "license": self.license, "notes": self.notes}
