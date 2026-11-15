"""Starting frameworks for the two MVP scenarios.

Used directly by the rule-based planner and offered to the LLM agent as
worked examples. The LLM agent is free to build a different framework for
any industry from the catalog.

`unavailable` lists variables the analysis should use but for which no
dataset is connected yet. They are shown to the user instead of being
silently dropped or invented.
"""

SOLAR_UNAVAILABLE = [
    {"name": "Land acquisition or lease cost", "reason": "No global open dataset connected. Needs national land registries or commercial data."},
    {"name": "Distance to transmission lines and substations", "reason": "Requires an OpenStreetMap / national grid connector (planned). Access to electricity is used as a coarse proxy."},
    {"name": "Grid connection cost", "reason": "Project-specific; no open dataset."},
    {"name": "Electricity market price / feed-in tariff", "reason": "No connector yet. Varies by contract and regulator."},
    {"name": "Wages of solar installers specifically", "reason": "ILOSTAT publishes earnings for all employees and for construction, with gaps for many countries; GNI per capita stands in where it is missing."},
    {"name": "Panel, steel and equipment prices", "reason": "Priced on world markets; no connector yet."},
    {"name": "Permitting, land ownership and foreign investment rules", "reason": "Legal texts are not a dataset. Must be verified per country; only perception-based governance indices are included."},
    {"name": "Flood and environmental-protection constraints", "reason": "Requires hazard and protected-area layers (planned)."},
]


def solar() -> dict:
    V = lambda id, w, d, why: {"id": id, "weight": w, "direction": d, "rationale": why}  # noqa: E731
    return {
        "title": "Solar farm siting",
        "objective": "Identify locations where utility-scale solar PV looks most favourable.",
        "variables": [
            # --- solar resource (how much sun, how steady)
            V("power.ghi", 16, "higher", "Main driver of PV energy yield."),
            V("power.pv_yield", 7, "higher", "Rough energy output per installed kWp, after heat losses."),
            V("power.dni", 5, "higher", "Matters for tracking and concentrating systems."),
            V("power.clearness", 3, "higher", "Clearer skies mean more predictable output."),
            V("power.ghi_min_month", 4, "higher", "Output in the weakest month sets the worst case."),
            V("power.ghi_seasonality", 3, "higher", "Steadier output across the year."),
            V("power.cloud", 2, "lower", "Less cloud means less output variability."),
            V("power.temp_max", 2, "lower", "Hot afternoons reduce module efficiency."),
            V("wb.pm25", 2, "lower", "Dust and haze soil the panels and raise cleaning cost."),
            # --- cost of building and running
            V("wb.price_level", 8, "lower", "Stand-in for local construction cost."),
            V("ilo.wage", 4, "lower", "Reported earnings: what workers are actually paid."),
            V("ilo.wage_construction", 2, "lower", "Reported earnings of construction workers."),
            V("wb.gni_pc", 4, "lower", "Stand-in for labour cost where no wage figure is published."),
            V("wb.lending_rate", 3, "lower", "Solar is capital-heavy, so financing cost matters."),
            V("wb.inflation", 2, "lower", "Price and currency stability over a 25-year asset life."),
            V("wb.import_tariff", 1, "lower", "Panels and inverters are usually imported."),
            # --- grid and market
            V("wb.electricity_access", 4, "higher", "Stand-in for grid reach."),
            V("wb.grid_losses", 3, "lower", "A lossy grid delivers less of what is generated."),
            V("wb.outages", 2, "lower", "Grid reliability for evacuation of power."),
            V("wb.power_use_pc", 2, "higher", "Size of the electricity market."),
            V("wb.fossil_power_share", 2, "higher", "More fossil generation for solar to displace."),
            # --- logistics
            V("wb.lpi_infra", 5, "higher", "Roads and ports for moving equipment."),
            V("wb.lpi_customs", 2, "higher", "Clearing imported equipment."),
            V("wb.port_connectivity", 2, "higher", "Sea freight access for panels and steel."),
            # --- risk
            V("wb.regulatory_quality", 3, "higher", "Regulatory predictability."),
            V("wb.political_stability", 3, "higher", "Political risk."),
            V("wb.rule_of_law", 2, "higher", "Enforceability of long-term power contracts."),
            V("wb.corruption_control", 1, "higher", "Permitting integrity."),
            # --- land
            V("wb.pop_density", 2, "lower", "Stand-in for land pressure."),
            V("wb.forest_share", 1, "lower", "Forest is unavailable or costly to clear."),
        ],
        "unavailable": SOLAR_UNAVAILABLE,
    }


# Illustrative crop requirement ranges. SAMPLE PARAMETERS, not an agronomic
# reference — replace with FAO ECOCROP values before relying on results.
CROPS = {
    "carrot": {"temp": [15, 21], "rain_mm_yr": [500, 1000], "ph": [6.0, 6.8], "clay": [5, 25]},
    "maize": {"temp": [18, 30], "rain_mm_yr": [600, 1200], "ph": [5.8, 7.0], "clay": [10, 35]},
    "wheat": {"temp": [12, 22], "rain_mm_yr": [450, 900], "ph": [6.0, 7.5], "clay": [15, 40]},
    "rice": {"temp": [22, 30], "rain_mm_yr": [1000, 2200], "ph": [5.5, 7.0], "clay": [30, 60]},
    "coffee": {"temp": [18, 24], "rain_mm_yr": [1200, 2200], "ph": [5.0, 6.5], "clay": [15, 45]},
    "potato": {"temp": [14, 20], "rain_mm_yr": [500, 1000], "ph": [5.0, 6.5], "clay": [5, 30]},
}
CROP_ALIASES = {"carrots": "carrot", "corn": "maize", "potatoes": "potato"}

AGRI_UNAVAILABLE = [
    {"name": "Agricultural land price or rent", "reason": "No global open dataset connected."},
    {"name": "Agricultural wages specifically", "reason": "ILOSTAT earnings cover all employees and are missing for many countries; farm-sector wages are not connected."},
    {"name": "Seed, fertilizer and irrigation prices", "reason": "No connector yet (FAOSTAT price series planned)."},
    {"name": "Local market prices for the crop", "reason": "No connector yet (FAOSTAT producer prices planned)."},
    {"name": "Water-use restrictions, land-use rules, subsidies, trade rules", "reason": "Legal texts are not a dataset. Must be verified per country."},
    {"name": "Growing-season length and rainfall distribution", "reason": "Annual means only in this version; monthly climatology is retrieved but not yet scored."},
]


def agriculture(crop: str | None) -> dict:
    key = CROP_ALIASES.get((crop or "").lower(), (crop or "").lower())
    prof = CROPS.get(key)
    sample_note = ("Target range is an illustrative sample parameter for this crop, not an agronomic reference. "
                   "Replace with FAO ECOCROP values before relying on it.")
    if prof:
        lo, hi = prof["rain_mm_yr"]
        variables = [
            {"id": "power.temp", "weight": 18, "direction": "target", "target": prof["temp"], "rationale": "Crop temperature requirement.", "assumption": sample_note},
            {"id": "power.precip", "weight": 15, "direction": "target", "target": [round(lo / 365, 2), round(hi / 365, 2)],
             "rationale": f"Rainfall requirement ({lo}–{hi} mm/year expressed per day).", "assumption": sample_note},
            {"id": "power.soil_wetness", "weight": 7, "direction": "higher", "rationale": "Moisture available in the root zone."},
            {"id": "soil.ph", "weight": 10, "direction": "target", "target": prof["ph"], "rationale": "Soil acidity requirement.", "assumption": sample_note},
            {"id": "soil.clay", "weight": 7, "direction": "target", "target": prof["clay"], "rationale": "Texture and drainage.", "assumption": sample_note},
            {"id": "soil.soc", "weight": 5, "direction": "higher", "rationale": "Organic matter."},
        ]
        title = f"{key.capitalize()} growing suitability"
    else:
        variables = [
            {"id": "power.precip", "weight": 20, "direction": "higher", "rationale": "Rain-fed water supply."},
            {"id": "power.soil_wetness", "weight": 15, "direction": "higher", "rationale": "Moisture available in the root zone."},
            {"id": "soil.soc", "weight": 8, "direction": "higher", "rationale": "Organic matter."},
            {"id": "soil.nitrogen", "weight": 7, "direction": "higher", "rationale": "Nutrient availability."},
        ]
        title = "General agricultural potential"
    variables += [
        {"id": "wb.arable_land", "weight": 8, "direction": "higher", "rationale": "Share of land already suited to cropping."},
        {"id": "wb.freshwater_pc", "weight": 8, "direction": "higher", "rationale": "Water available for irrigation."},
        {"id": "wb.irrigated_land", "weight": 3, "direction": "higher", "rationale": "Existing irrigation capacity."},
        {"id": "wb.water_stress", "weight": 4, "direction": "lower", "rationale": "Competition for water."},
        {"id": "power.precip_min_month", "weight": 3, "direction": "higher", "rationale": "Severity of the dry season."},
        {"id": "wb.cereal_yield", "weight": 3, "direction": "higher", "rationale": "What farms there achieve today (cereals only)."},
        {"id": "wb.fertilizer", "weight": 2, "direction": "higher", "rationale": "Availability of farm inputs."},
        {"id": "wb.gni_pc", "weight": 4, "direction": "lower", "rationale": "Stand-in for labour cost."},
        {"id": "ilo.wage", "weight": 3, "direction": "lower", "rationale": "Reported earnings of employees."},
        {"id": "wb.agri_productivity", "weight": 2, "direction": "lower", "rationale": "Stand-in for farm labour cost."},
        {"id": "wb.agri_employment", "weight": 2, "direction": "higher", "rationale": "Available farm workforce."},
        {"id": "wb.electricity_access_rural", "weight": 2, "direction": "higher", "rationale": "Power for pumping and cold storage."},
        {"id": "wb.lpi_overall", "weight": 6, "direction": "higher", "rationale": "Getting produce to market."},
        {"id": "wb.lending_rate", "weight": 2, "direction": "lower", "rationale": "Cost of farm credit."},
        {"id": "wb.inflation", "weight": 1, "direction": "lower", "rationale": "Price stability."},
        {"id": "wb.regulatory_quality", "weight": 3, "direction": "higher", "rationale": "Regulatory predictability."},
        {"id": "wb.political_stability", "weight": 2, "direction": "higher", "rationale": "Political risk."},
    ]
    unavailable = list(AGRI_UNAVAILABLE)
    if crop and not prof:
        unavailable.insert(0, {"name": f"Crop-specific requirements for {crop}", "reason": "No requirement profile connected for this crop, so general agricultural potential is assessed instead."})
    return {
        "title": title,
        "objective": "Estimate where growing conditions and basic economics look most suitable. A suitability score is not a yield or profit forecast.",
        "variables": variables,
        "unavailable": unavailable,
    }
