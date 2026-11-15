"""Connector registry and variable catalog.

The catalog is what the agent chooses from when it builds a research
framework. Besides the curated entries it accepts two dynamic id forms, so
the framework is not limited to a fixed variable list:

    wb:<INDICATOR_CODE>     any World Bank indicator, e.g. wb:EG.ELC.RNEW.ZS
    power:<PARAMETER>       any NASA POWER climatology parameter, e.g. power:WS50M
"""
from .base import (KIND_ESTIMATED, KIND_MODELLED, KIND_PREDICTED, KIND_PROXY, KIND_REPORTED, KIND_SURVEY, Connector, VariableDef)
from .ilostat import IloStat
from .nasa_power import NasaPower
from .soilgrids import SoilGrids
from .world_bank import WorldBank

CONNECTORS: dict[str, Connector] = {c.id: c for c in (NasaPower(), WorldBank(), IloStat(), SoilGrids())}

_POWER_RES = "≈0.5°–1° grid; country value = mean of sample points"
_WB_RES = "country"
_SOIL_RES = "250 m grid; single point per country"


def _p(id, label, param, units, category, kw, direction="higher", community="RE", stat="ANN", desc="", kind=KIND_MODELLED, also=()):
    return VariableDef(id=id, label=label, connector="nasa_power", param=param, units=units, kind=kind,
                       resolution=_POWER_RES, category=category, keywords=kw, default_direction=direction,
                       description=desc, stat=stat, extra={"community": community, "also": list(also)})


def _i(id, label, units, kw, classif1=None, desc=""):
    return VariableDef(id=id, label=label, connector="ilostat", param="EAR_4MTH_SEX_ECO_CUR_NB_A", units=units, kind=KIND_REPORTED,
                       resolution=_WB_RES, category="Workforce", keywords=kw, default_direction="lower", description=desc,
                       extra={"classif1": classif1})


def _w(id, label, code, units, category, kw, direction="higher", kind=KIND_REPORTED, proxy=None, pct=True, desc=""):
    return VariableDef(id=id, label=label, connector="world_bank", param=code, units=units, kind=kind,
                       resolution=_WB_RES, category=category, keywords=kw, default_direction=direction,
                       proxy_note=proxy, pct_meaningful=pct, description=desc)


def _s(id, label, prop, units, kw, direction="target", desc=""):
    return VariableDef(id=id, label=label, connector="soilgrids", param=prop, units=units, kind=KIND_PREDICTED,
                       resolution=_SOIL_RES, category="Soil", keywords=kw, default_direction=direction, description=desc)


_ENTRIES = [
    # ================= NASA POWER: solar resource
    _p("power.ghi", "Global horizontal irradiance", "ALLSKY_SFC_SW_DWN", "kWh/m²/day", "Environment",
       ["irradiance", "solar", "sun", "ghi", "insolation", "production"], desc="All-sky surface shortwave downward irradiance, annual mean."),
    _p("power.pv_yield", "Estimated PV output", "ALLSKY_SFC_SW_DWN", "kWh per kWp per year", "Environment",
       ["pv output", "yield", "solar", "production", "generation", "energy output"], stat="pv_yield", kind=KIND_ESTIMATED, also=["T2M"],
       desc="Calculated here: irradiance × 365 × performance ratio 0.80, reduced 0.4 % per °C of cell temperature above 25 °C "
            "(cell ≈ air temperature + 20 °C). Horizontal fixed array, no tilt or tracking gain. A rough estimate, not a yield study."),
    _p("power.dni", "Direct normal irradiance", "ALLSKY_SFC_SW_DNI", "kWh/m²/day", "Environment",
       ["irradiance", "dni", "direct normal", "solar", "production"], desc="All-sky direct normal irradiance, annual mean."),
    _p("power.ghi_clear", "Clear-sky irradiance", "CLRSKY_SFC_SW_DWN", "kWh/m²/day", "Environment",
       ["clear sky", "solar"], desc="Irradiance that would reach the surface without clouds."),
    _p("power.clearness", "Clearness index", "ALLSKY_KT", "fraction (0–1)", "Environment",
       ["clearness", "solar", "sky"], desc="Share of top-of-atmosphere sunlight that reaches the surface. Higher means clearer skies."),
    _p("power.diffuse", "Diffuse irradiance", "ALLSKY_SFC_SW_DIFF", "kWh/m²/day", "Environment",
       ["diffuse", "haze"], direction="lower", desc="Scattered sunlight. A high share means hazy or cloudy skies."),
    _p("power.ghi_min_month", "Irradiance in the weakest month", "ALLSKY_SFC_SW_DWN", "kWh/m²/day", "Environment",
       ["worst month", "winter", "solar", "production"], stat="min_month", desc="Lowest monthly mean irradiance of the year."),
    _p("power.ghi_max_month", "Irradiance in the strongest month", "ALLSKY_SFC_SW_DWN", "kWh/m²/day", "Environment",
       ["best month", "summer"], stat="max_month", desc="Highest monthly mean irradiance of the year."),
    _p("power.ghi_seasonality", "Seasonal stability of irradiance", "ALLSKY_SFC_SW_DWN", "ratio (weakest ÷ strongest month)", "Environment",
       ["seasonal", "seasonality", "variation", "stability"], stat="seasonal_ratio",
       desc="Lowest monthly irradiance divided by the highest. 1.0 means no seasonal swing."),
    _p("power.cloud", "Cloud amount", "CLOUD_AMT", "%", "Environment", ["cloud"], direction="lower", desc="Average cloud cover."),
    _p("power.albedo", "Surface albedo", "ALLSKY_SRF_ALB", "fraction (0–1)", "Environment", ["albedo", "bifacial", "reflect"],
       desc="Share of sunlight reflected by the ground. Relevant for bifacial modules."),

    # ================= NASA POWER: climate
    _p("power.temp", "Air temperature at 2 m", "T2M", "°C", "Climate", ["temperature", "heat", "cooling", "thermal"],
       direction="lower", desc="Annual mean. Growing-season temperature can differ substantially."),
    _p("power.temp_max", "Mean daily maximum temperature", "T2M_MAX", "°C", "Climate", ["hot", "heat", "maximum temperature"],
       direction="lower", desc="Annual mean of daily maxima. Hot afternoons reduce PV module efficiency."),
    _p("power.temp_min", "Mean daily minimum temperature", "T2M_MIN", "°C", "Climate", ["cold", "frost", "minimum temperature"]),
    _p("power.temp_range", "Daily temperature range", "T2M_RANGE", "°C", "Climate", ["temperature range", "diurnal"], direction="lower"),
    _p("power.surface_temp", "Earth skin temperature", "TS", "°C", "Climate", ["surface temperature", "ground temperature"], direction="lower"),
    _p("power.precip", "Precipitation", "PRECTOTCORR", "mm/day", "Climate", ["rain", "rainfall", "precipitation", "water"],
       desc="Bias-corrected precipitation, annual mean of daily totals."),
    _p("power.precip_year", "Annual precipitation", "PRECTOTCORR", "mm per year", "Climate", ["annual rain", "rainfall total"],
       stat="annual_sum", kind=KIND_ESTIMATED, desc="Calculated here: mean daily precipitation × 365."),
    _p("power.precip_min_month", "Precipitation in the driest month", "PRECTOTCORR", "mm/day", "Climate", ["dry season", "drought"], stat="min_month"),
    _p("power.humidity", "Relative humidity at 2 m", "RH2M", "%", "Climate", ["humidity"]),
    _p("power.dew_point", "Dew point at 2 m", "T2MDEW", "°C", "Climate", ["dew", "condensation"]),
    _p("power.soil_wetness", "Root-zone soil wetness", "GWETROOT", "fraction (0–1)", "Climate",
       ["soil moisture", "moisture", "wetness", "drought"], desc="Modelled root-zone wetness; 0 = completely dry, 1 = saturated."),
    _p("power.top_wetness", "Surface soil wetness", "GWETTOP", "fraction (0–1)", "Climate", ["surface moisture", "topsoil moisture"]),
    _p("power.wind10", "Wind speed at 10 m", "WS10M", "m/s", "Environment", ["wind", "breeze", "module cooling"]),
    _p("power.wind50", "Wind speed at 50 m", "WS50M", "m/s", "Environment", ["wind", "turbine"]),
    _p("power.pressure", "Surface pressure", "PS", "kPa", "Climate", ["pressure", "altitude", "elevation"],
       desc="Lower pressure indicates higher terrain."),

    # ================= ILOSTAT: wages
    _i("ilo.wage", "Mean monthly earnings of employees", "US$ per month", ["labor", "labour", "wage", "salar", "earnings", "pay", "workforce cost"],
       desc="Mean nominal monthly earnings, all economic activities, converted to US$ by the ILO."),
    _i("ilo.wage_construction", "Mean monthly earnings in construction", "US$ per month", ["construction wage", "labor", "labour", "wage", "salar", "builder"],
       classif1=["ECO_AGGREGATE_CON", "ECO_SECTOR_CON", "ECO_ISIC4_F", "ECO_ISIC3_F"],
       desc="Mean nominal monthly earnings of employees in the construction sector, US$."),

    # ================= World Bank: energy system
    _w("wb.electricity_access", "Access to electricity", "EG.ELC.ACCS.ZS", "% of population", "Infrastructure",
       ["infrastructure", "grid", "electricity access", "transmission"], kind=KIND_PROXY,
       proxy="Proxy for grid reach. It is not distance to transmission lines or substations."),
    _w("wb.electricity_access_rural", "Access to electricity, rural", "EG.ELC.ACCS.RU.ZS", "% of rural population", "Infrastructure",
       ["rural electricity", "rural grid", "off-grid"], kind=KIND_PROXY, proxy="Proxy for how far the grid reaches outside cities."),
    _w("wb.power_use_pc", "Electric power consumption", "EG.USE.ELEC.KH.PC", "kWh per person", "Energy",
       ["electricity demand", "power consumption", "demand", "market size"], desc="Size of the electricity market per person."),
    _w("wb.grid_losses", "Transmission and distribution losses", "EG.ELC.LOSS.ZS", "% of output", "Energy",
       ["grid losses", "transmission losses", "grid quality", "infrastructure"], direction="lower", desc="Share of generated electricity lost in the grid."),
    _w("wb.outages", "Power outages in firms", "IC.ELC.OUTG", "number in a typical month", "Energy",
       ["outage", "blackout", "reliability", "grid quality"], direction="lower", kind=KIND_SURVEY,
       desc="World Bank Enterprise Surveys. Survey years differ widely between countries."),
    _w("wb.outage_losses", "Sales lost to power outages", "IC.FRM.OUTG.ZS", "% of sales", "Energy",
       ["outage cost", "reliability"], direction="lower", kind=KIND_SURVEY),
    _w("wb.grid_connection_days", "Time required to get electricity", "IC.ELC.TIME", "days", "Energy",
       ["grid connection", "connection time", "permit"], direction="lower",
       desc="From the discontinued Doing Business series; check the reference year."),
    _w("wb.fossil_power_share", "Electricity from oil, gas and coal", "EG.ELC.FOSL.ZS", "% of total", "Energy",
       ["fossil", "displacement", "coal", "gas"], desc="Higher share means more fossil generation that solar could displace."),
    _w("wb.renewable_share", "Renewable electricity output", "EG.ELC.RNEW.ZS", "% of total electricity output", "Energy", ["renewable", "clean energy"]),
    _w("wb.renewable_consumption", "Renewable energy consumption", "EG.FEC.RNEW.ZS", "% of final energy", "Energy", ["renewable consumption"]),
    _w("wb.energy_imports", "Energy imports, net", "EG.IMP.CONS.ZS", "% of energy use", "Energy",
       ["energy import", "energy security", "dependence"], desc="Negative values mean the country is a net exporter."),
    _w("wb.energy_use_pc", "Energy use", "EG.USE.PCAP.KG.OE", "kg of oil equivalent per person", "Energy", ["energy use", "energy demand"]),

    # ================= World Bank: logistics and connectivity
    _w("wb.lpi_infra", "Logistics Performance Index — infrastructure", "LP.LPI.INFR.XQ", "index 1–5", "Infrastructure",
       ["infrastructure", "logistics", "transport", "road", "port"], kind=KIND_SURVEY,
       desc="Survey-based rating of trade and transport infrastructure quality."),
    _w("wb.lpi_overall", "Logistics Performance Index — overall", "LP.LPI.OVRL.XQ", "index 1–5", "Infrastructure",
       ["logistics", "supply chain", "distribution"], kind=KIND_SURVEY),
    _w("wb.lpi_customs", "Logistics Performance Index — customs", "LP.LPI.CUST.XQ", "index 1–5", "Infrastructure",
       ["customs", "import clearance", "border"], kind=KIND_SURVEY, desc="Efficiency of customs clearance. Matters for imported equipment."),
    _w("wb.lpi_timeliness", "Logistics Performance Index — timeliness", "LP.LPI.TIME.XQ", "index 1–5", "Infrastructure",
       ["timeliness", "delivery", "shipping time"], kind=KIND_SURVEY),
    _w("wb.lpi_shipments", "Logistics Performance Index — international shipments", "LP.LPI.ITRN.XQ", "index 1–5", "Infrastructure",
       ["shipment", "freight", "shipping"], kind=KIND_SURVEY),
    _w("wb.port_connectivity", "Liner shipping connectivity", "IS.SHP.GCNW.XQ", "index", "Infrastructure",
       ["port", "shipping", "sea freight", "maritime"], desc="UNCTAD index of how well a country is connected to container shipping networks. Landlocked countries have no value."),
    _w("wb.container_traffic", "Container port traffic", "IS.SHP.GOOD.TU", "TEU", "Infrastructure", ["container", "port traffic"]),
    _w("wb.rail_km", "Rail lines", "IS.RRS.TOTL.KM", "route-km", "Infrastructure", ["rail", "railway", "train"]),
    _w("wb.internet_users", "Individuals using the Internet", "IT.NET.USER.ZS", "% of population", "Connectivity", ["internet", "connectivity", "telecom"]),
    _w("wb.broadband", "Fixed broadband subscriptions", "IT.NET.BBND.P2", "per 100 people", "Connectivity", ["broadband", "fibre", "fiber", "connectivity"]),
    _w("wb.mobile", "Mobile cellular subscriptions", "IT.CEL.SETS.P2", "per 100 people", "Connectivity", ["mobile", "cellular", "telecom"]),
    _w("wb.secure_servers", "Secure Internet servers", "IT.NET.SECR.P6", "per million people", "Connectivity", ["server", "data center", "digital"]),

    # ================= World Bank: costs, prices, finance
    _w("wb.price_level", "General price level", "PA.NUS.PPPC.RF", "ratio (PPP factor ÷ market exchange rate)", "Economics",
       ["construction", "capex", "build cost", "price level", "material"], direction="lower", kind=KIND_PROXY,
       proxy="Proxy for local construction cost. It is the economy-wide price level, not a construction-cost survey; "
             "imported equipment such as panels and steel is priced on world markets and is not captured."),
    _w("wb.gni_pc", "GNI per capita", "NY.GNP.PCAP.CD", "current US$", "Economics",
       ["labor", "labour", "wage", "salar", "workforce cost"], direction="lower", kind=KIND_PROXY,
       proxy="Proxy for wage level. It is average national income, not a wage or salary statistic."),
    _w("wb.gdp_pc", "GDP per capita", "NY.GDP.PCAP.CD", "current US$", "Economics", ["gdp per capita", "income level"]),
    _w("wb.gdp_pc_ppp", "GDP per capita, PPP", "NY.GDP.PCAP.PP.CD", "current international $", "Economics", ["purchasing power", "ppp"]),
    _w("wb.gdp", "GDP", "NY.GDP.MKTP.CD", "current US$", "Economics", ["economy size", "gdp", "market size"]),
    _w("wb.gdp_growth", "GDP growth", "NY.GDP.MKTP.KD.ZG", "annual %", "Economics", ["growth", "economic growth"], pct=False),
    _w("wb.inflation", "Inflation, consumer prices", "FP.CPI.TOTL.ZG", "annual %", "Economics",
       ["inflation", "price stability", "currency risk"], direction="lower", pct=False),
    _w("wb.lending_rate", "Lending interest rate", "FR.INR.LEND", "%", "Economics",
       ["interest", "financing cost", "cost of capital", "loan", "finance"], direction="lower", kind=KIND_PROXY,
       proxy="Proxy for the cost of local financing. Project finance is usually priced differently, often in foreign currency."),
    _w("wb.real_interest", "Real interest rate", "FR.INR.RINR", "%", "Economics", ["real interest"], direction="lower", pct=False),
    _w("wb.private_credit", "Domestic credit to private sector", "FS.AST.PRVT.GD.ZS", "% of GDP", "Economics", ["credit", "banking", "financial depth"]),
    _w("wb.investment_rate", "Gross capital formation", "NE.GDI.TOTL.ZS", "% of GDP", "Economics", ["capital formation", "investment rate"]),
    _w("wb.fdi", "Foreign direct investment, net inflows", "BX.KLT.DINV.WD.GD.ZS", "% of GDP", "Economics", ["investment", "fdi", "foreign"], pct=False),
    _w("wb.trade_openness", "Trade", "NE.TRD.GNFS.ZS", "% of GDP", "Economics", ["trade", "openness", "export"]),
    _w("wb.import_tariff", "Applied import tariff, weighted mean", "TM.TAX.MRCH.WM.AR.ZS", "%", "Economics",
       ["tariff", "import duty", "customs duty", "equipment import"], direction="lower",
       desc="Average tariff across all products. The rate on solar equipment specifically can differ."),
    _w("wb.tax_rate", "Total tax and contribution rate", "IC.TAX.TOTL.CP.ZS", "% of profit", "Economics",
       ["tax"], direction="lower", desc="From the discontinued Doing Business series; check the reference year."),

    # ================= World Bank: workforce and people
    _w("wb.labor_force", "Labor force", "SL.TLF.TOTL.IN", "people", "Workforce", ["workforce", "labor force", "labour force"]),
    _w("wb.labor_productivity", "GDP per person employed", "SL.GDP.PCAP.EM.KD", "constant PPP $", "Workforce",
       ["productivity", "output per worker"], desc="Output per worker. Tends to move with wage levels."),
    _w("wb.unemployment", "Unemployment", "SL.UEM.TOTL.ZS", "% of labor force", "Workforce", ["unemployment", "labor availability", "jobless"],
       desc="ILO modelled estimate."),
    _w("wb.participation", "Labor force participation", "SL.TLF.CACT.ZS", "% of population 15+", "Workforce", ["participation"]),
    _w("wb.wage_workers", "Wage and salaried workers", "SL.EMP.WORK.ZS", "% of employment", "Workforce",
       ["formal employment", "salaried", "formal labor"], desc="Share of workers in paid employment. A rough sign of a formal labour market."),
    _w("wb.industry_employment", "Employment in industry", "SL.IND.EMPL.ZS", "% of employment", "Workforce", ["industrial workforce", "skilled labor", "technician"]),
    _w("wb.secondary_enrollment", "School enrollment, secondary", "SE.SEC.ENRR", "% gross", "Workforce", ["education", "secondary", "skills"]),
    _w("wb.tertiary_enrollment", "School enrollment, tertiary", "SE.TER.ENRR", "% gross", "Workforce", ["university", "engineer", "tertiary", "skills"]),
    _w("wb.literacy", "Adult literacy", "SE.ADT.LITR.ZS", "% of people 15+", "Workforce", ["literacy"]),
    _w("wb.population", "Population", "SP.POP.TOTL", "people", "Workforce", ["population", "market size"]),
    _w("wb.pop_growth", "Population growth", "SP.POP.GROW", "annual %", "Workforce", ["population growth", "demand growth"], pct=False),
    _w("wb.urban_share", "Urban population", "SP.URB.TOTL.IN.ZS", "% of population", "Workforce", ["urban", "city"]),

    # ================= World Bank: governance
    _w("wb.regulatory_quality", "Regulatory quality (WGI)", "RQ.EST", "estimate (−2.5 to 2.5)", "Governance",
       ["regulat", "policy", "permit", "legal"], kind=KIND_SURVEY, pct=False,
       desc="Perception-based governance estimate. It does not describe any specific law or permit."),
    _w("wb.political_stability", "Political stability (WGI)", "PV.EST", "estimate (−2.5 to 2.5)", "Governance",
       ["political", "stability", "risk", "security"], kind=KIND_SURVEY, pct=False),
    _w("wb.rule_of_law", "Rule of law (WGI)", "RL.EST", "estimate (−2.5 to 2.5)", "Governance",
       ["rule of law", "contract", "property rights", "courts"], kind=KIND_SURVEY, pct=False),
    _w("wb.corruption_control", "Control of corruption (WGI)", "CC.EST", "estimate (−2.5 to 2.5)", "Governance",
       ["corruption", "bribe", "transparency"], kind=KIND_SURVEY, pct=False),
    _w("wb.gov_effectiveness", "Government effectiveness (WGI)", "GE.EST", "estimate (−2.5 to 2.5)", "Governance",
       ["government effectiveness", "bureaucracy", "public services"], kind=KIND_SURVEY, pct=False),
    _w("wb.voice", "Voice and accountability (WGI)", "VA.EST", "estimate (−2.5 to 2.5)", "Governance", ["accountability"], kind=KIND_SURVEY, pct=False),

    # ================= World Bank: land, water, environment
    _w("wb.pop_density", "Population density", "EN.POP.DNST", "people per km²", "Land",
       ["land", "density", "land availability"], direction="lower", kind=KIND_PROXY,
       proxy="Proxy for land pressure. It says nothing about ownership, price or zoning."),
    _w("wb.land_area", "Land area", "AG.LND.TOTL.K2", "km²", "Land", ["land area", "country size"]),
    _w("wb.forest_share", "Forest area", "AG.LND.FRST.ZS", "% of land area", "Land", ["forest", "tree cover", "clearing"], direction="lower",
       desc="Forested land is generally unavailable or costly to clear."),
    _w("wb.agri_land", "Agricultural land", "AG.LND.AGRI.ZS", "% of land area", "Land", ["agricultural land", "farmland competition"]),
    _w("wb.protected_land", "Terrestrial protected areas", "ER.LND.PTLD.ZS", "% of land area", "Land", ["protected", "conservation", "nature reserve"], direction="lower"),
    _w("wb.arable_land", "Arable land", "AG.LND.ARBL.ZS", "% of land area", "Land", ["arable", "farmland", "land"]),
    _w("wb.arable_pc", "Arable land per person", "AG.LND.ARBL.HA.PC", "hectares per person", "Land", ["arable per person"]),
    _w("wb.cropland", "Permanent cropland", "AG.LND.CROP.ZS", "% of land area", "Land", ["orchard", "plantation", "permanent crop"]),
    _w("wb.pm25", "Fine particulate air pollution (PM2.5)", "EN.ATM.PM25.MC.M3", "µg/m³", "Environment",
       ["dust", "soiling", "air pollution", "haze"], direction="lower", kind=KIND_PROXY,
       proxy="Proxy for dust and soiling on panels. It is population-weighted air pollution, not a measurement at solar sites."),
    _w("wb.freshwater_pc", "Renewable internal freshwater per capita", "ER.H2O.INTR.PC", "m³ per person", "Water", ["water", "freshwater", "irrigation"]),
    _w("wb.water_stress", "Level of water stress", "ER.H2O.FWST.ZS", "% of available freshwater withdrawn", "Water",
       ["water stress", "water scarcity", "panel cleaning"], direction="lower"),
    _w("wb.water_withdrawal", "Annual freshwater withdrawals", "ER.H2O.FWTL.ZS", "% of internal resources", "Water", ["withdrawal"], direction="lower"),

    # ================= World Bank: agriculture
    _w("wb.cereal_yield", "Cereal yield", "AG.YLD.CREL.KG", "kg per hectare", "Agriculture",
       ["yield", "productivity"], desc="Reported national cereal yield. Not a forecast for any other crop."),
    _w("wb.fertilizer", "Fertilizer consumption", "AG.CON.FERT.ZS", "kg per hectare of arable land", "Agriculture", ["fertilizer", "fertiliser", "input"]),
    _w("wb.irrigated_land", "Irrigated agricultural land", "AG.LND.IRIG.AG.ZS", "% of agricultural land", "Agriculture", ["irrigated", "irrigation"]),
    _w("wb.precip_national", "Average precipitation in depth", "AG.LND.PRCP.MM", "mm per year", "Agriculture", ["national rainfall"]),
    _w("wb.agri_value_added", "Agriculture value added", "NV.AGR.TOTL.ZS", "% of GDP", "Agriculture", ["agriculture share", "farm sector"]),
    _w("wb.agri_employment", "Employment in agriculture", "SL.AGR.EMPL.ZS", "% of employment", "Agriculture", ["farm labor", "agricultural workforce", "farm worker"]),
    _w("wb.agri_productivity", "Agriculture value added per worker", "NV.AGR.EMPL.KD", "constant US$", "Agriculture",
       ["farm productivity", "agricultural wage"], kind=KIND_PROXY, direction="lower",
       proxy="Proxy for agricultural labour cost. It is output per farm worker, not a wage."),
    _w("wb.crop_index", "Crop production index", "AG.PRD.CROP.XD", "index (2014–2016 = 100)", "Agriculture", ["crop production", "output trend"]),
    _w("wb.food_index", "Food production index", "AG.PRD.FOOD.XD", "index (2014–2016 = 100)", "Agriculture", ["food production"]),

    # ================= World Bank: industry and mining
    _w("wb.industry_share", "Industry value added", "NV.IND.TOTL.ZS", "% of GDP", "Industry", ["industry", "industrial base"]),
    _w("wb.manufacturing_share", "Manufacturing value added", "NV.IND.MANF.ZS", "% of GDP", "Industry", ["manufacturing", "factory"]),
    _w("wb.ores_exports", "Ores and metals exports", "TX.VAL.MMTL.ZS.UN", "% of merchandise exports", "Mining",
       ["mining", "ore", "metal", "mineral"], kind=KIND_PROXY,
       proxy="Proxy for an established mining sector. It is not a measure of deposits or reserves."),
    _w("wb.mineral_rents", "Mineral rents", "NY.GDP.MINR.RT.ZS", "% of GDP", "Mining", ["mineral rent", "mining revenue"]),
    _w("wb.resource_rents", "Total natural resource rents", "NY.GDP.TOTL.RT.ZS", "% of GDP", "Mining", ["resource rent", "natural resources"]),
    _w("wb.fuel_exports", "Fuel exports", "TX.VAL.FUEL.ZS.UN", "% of merchandise exports", "Mining", ["oil", "fuel export", "petroleum"]),

    # ================= SoilGrids
    _s("soil.ph", "Topsoil pH (water)", "phh2o", "pH", ["ph", "acidity", "soil"]),
    _s("soil.clay", "Topsoil clay content", "clay", "%", ["clay", "texture", "drainage", "soil"]),
    _s("soil.sand", "Topsoil sand content", "sand", "%", ["sand", "texture", "drainage", "soil"]),
    _s("soil.silt", "Topsoil silt content", "silt", "%", ["silt", "texture", "soil"]),
    _s("soil.soc", "Topsoil organic carbon", "soc", "g/kg", ["organic", "carbon", "organic matter", "soil"], direction="higher"),
    _s("soil.nitrogen", "Topsoil nitrogen", "nitrogen", "g/kg", ["nitrogen", "nutrient", "soil"], direction="higher"),
    _s("soil.cec", "Cation exchange capacity", "cec", "cmol(c)/kg", ["cec", "nutrient holding", "fertility", "soil"], direction="higher"),
    _s("soil.bulk_density", "Topsoil bulk density", "bdod", "kg/dm³", ["bulk density", "compaction", "soil"], direction="lower"),
]

CATALOG: dict[str, VariableDef] = {v.id: v for v in _ENTRIES}


def resolve(var_id: str) -> VariableDef | None:
    if var_id in CATALOG:
        return CATALOG[var_id]
    if var_id.startswith("wb:") and len(var_id) > 3:
        code = var_id[3:].strip().upper()
        return VariableDef(id=f"wb:{code}", label=f"World Bank indicator {code}", connector="world_bank", param=code,
                           units="see indicator definition", kind=KIND_REPORTED, resolution=_WB_RES, category="Custom",
                           description="Indicator requested dynamically by the agent.")
    if var_id.startswith("power:") and len(var_id) > 6:
        p = var_id[6:].strip().upper()
        return VariableDef(id=f"power:{p}", label=f"NASA POWER parameter {p}", connector="nasa_power", param=p,
                           units="see parameter definition", kind=KIND_MODELLED, resolution=_POWER_RES, category="Custom",
                           description="Parameter requested dynamically by the agent.", extra={"community": "RE"})
    return None


def catalog_public() -> list[dict]:
    return [v.public() for v in CATALOG.values()]


def connectors_public() -> list[dict]:
    return [c.describe() for c in CONNECTORS.values()]
