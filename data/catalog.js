/* =============================================================================
 * Safiery Store — Catalog (single source of truth)
 * UMD module: in the browser it sets window.SAFIERY_CATALOG; in Node
 * (the Stripe Netlify function) `require()` returns the same object so prices
 * are recomputed authoritatively server-side and cannot be spoofed.
 *
 * All prices are AUD and EXCLUSIVE of GST (matches the live Safiery cart which
 * shows the subtotal "ex. tax"). 10% GST is added at cart/checkout.
 * ========================================================================== */
(function (root) {
  "use strict";

  var GST_RATE = 0.10;

  // ---- B2B pricing tiers (reverse-engineered B2BKing % tiers) ---------------
  var b2bTiers = [
    { id: "trade",         name: "Trade",            discount: 0.10 },
    { id: "trade-plus",    name: "Trade Plus",       discount: 0.12 },
    { id: "reseller",      name: "Reseller",         discount: 0.15 },
    { id: "reseller-silver", name: "Reseller Silver", discount: 0.20 },
    { id: "reseller-gold", name: "Reseller Gold",    discount: 0.25 },
    { id: "distributor",   name: "Distributor",      discount: 0.30 },
    { id: "oem",           name: "OEM / Distributor Plus", discount: 0.32 }
  ];

  // ---- Demo B2B accounts (front-end demo auth → tier) -----------------------
  // In production these resolve from the Quasar JWT auth + Neon roster; here they
  // are hard-coded so every tier can be demonstrated. Password is the same for all.
  var DEMO_PASSWORD = "safiery2026";
  var demoAccounts = [
    { email: "trade@demo.safiery.com",       company: "Coastline Caravans",   tier: "trade" },
    { email: "tradeplus@demo.safiery.com",   company: "Outback Auto Electric", tier: "trade-plus" },
    { email: "reseller@demo.safiery.com",    company: "Marine Power Co",       tier: "reseller" },
    { email: "silver@demo.safiery.com",      company: "Nomad Fitouts",         tier: "reseller-silver" },
    { email: "gold@demo.safiery.com",        company: "BlueWater Systems",     tier: "reseller-gold" },
    { email: "distributor@demo.safiery.com", company: "Pacific Energy Dist.",  tier: "distributor" },
    { email: "oem@demo.safiery.com",         company: "Voyager OEM Group",     tier: "oem" }
  ];

  // ---- Categories -----------------------------------------------------------
  var categories = [
    { id: "12v-lithium",     name: "12V Lithium Batteries",  glyph: "battery", tag: "12V",
      blurb: "Solid-state 12V lithium with 10,000-cycle life and the safest chemistry available." },
    { id: "48v-lithium",     name: "48V Lithium Batteries",  glyph: "battery", tag: "48V",
      blurb: "High-voltage solid-state packs, on-board chargers and connection hardware." },
    { id: "scotty",          name: "Scotty AI DC-DC",        glyph: "converter", tag: "DC-DC",
      blurb: "AI-tuned bi-directional DC-DC converters, fully Victron VE.CAN compliant." },
    { id: "bmg",             name: "48V BMG Alternators",    glyph: "alternator", tag: "10kW",
      blurb: "Bi-directional Motor Generators — up to 10kW of silent on-engine power." },
    { id: "star-switching",  name: "STAR Digital Switching", glyph: "switch", tag: "CAN",
      blurb: "Wireless and CAN digital switching that integrates straight into Victron." },
    { id: "star-buttons",    name: "STAR Keypad Buttons",    glyph: "button", tag: "ICON",
      blurb: "Interchangeable engraved icon buttons for STAR keypads." },
    { id: "tank",            name: "Tank Monitoring",        glyph: "tank", tag: "SENSE",
      blurb: "Radar, pressure and resistive tank sensors for fuel, water, LPG and waste." },
    { id: "cooktops",        name: "Smart Induction Cooktops", glyph: "cooktop", tag: "COOK",
      blurb: "No-pulsing induction hobs engineered to run on a 2000W inverter." },
    { id: "hot-water",       name: "Electric Hot Water",     glyph: "water", tag: "HOT",
      blurb: "Tank and instant electric hot water — genset-free hot showers." },
    { id: "jupiter",         name: "Jupiter Canopy Packs",   glyph: "pack", tag: "PACK",
      blurb: "Upright all-in-one power packs: inverter, DC-DC, switching and lithium." },
    { id: "accessories",     name: "Accessories",            glyph: "accessory", tag: "ADD",
      blurb: "Lighting, GPOs, cooling, monitoring and the small parts that finish a build." }
  ];

  // ---- Shared spec blocks ---------------------------------------------------
  var SS_SPECS_12V = {
    "Nominal Voltage": "12V",
    "Nominal Capacity": "200Ah (2,777Wh)",
    "Parallel Connections": "32 units",
    "BMS": "CAN, Victron compatible",
    "Cycle Life": "10,000 cycles at 80% DOD",
    "Self Discharge": "< 2.5% / month",
    "Charge / Discharge Current": "200A (250A peak 2s)",
    "Charge Voltage": "14.4V ±0.8V",
    "Internal Resistance": "< 1 mOhm",
    "Operating Temp": "Discharge -20 to 55°C / Charge 0 to 55°C",
    "Warranty": "5 Years"
  };
  var SS_SPECS_48V = {
    "Nominal Voltage": "48V",
    "Nominal Capacity": "53.1Ah (2,712Wh)",
    "Parallel Connections": "32 units",
    "BMS": "CAN, Victron compatible",
    "Cycle Life": "10,000 cycles at 80% DOD",
    "Charge Voltage": "57.6V ±0.2V",
    "Internal Resistance": "< 1 mOhm",
    "Operating Temp": "Discharge -20 to 55°C / Charge 0 to 55°C",
    "Warranty": "5 Years"
  };
  var SCOTTY_SPECS = {
    "Type": "Bi-directional DC-DC converter",
    "Input / Output": "12V · 24V · 36V · 48V",
    "Bus": "VE.CAN 250kbaud (Victron compliant)",
    "Tuning": "AI auto-tune, 3 setpoints (Soft/Medium/Hard)",
    "Protection": "Alternator temp sensor + AI thermal back-off",
    "Switching": "Bi-directional load supply in 25ms",
    "Control": "Smartphone app + optional touch display (OTA updates)"
  };

  // ---- Products -------------------------------------------------------------
  // p(id, name, price, cats, opts)
  var products = [
    // --- 12V Lithium -------------------------------------------------------
    { id: "ss-12v-217", sku: "SS-12V-217", name: "Safiery Solid State Lithium 12V 217Ah 2,777Wh",
      price: 2440.00, cats: ["12v-lithium"], featured: true, stock: "in_stock",
      badges: ["217Ah", "5 Year Warranty", "IEC 62619", "10,000 Cycles"],
      short: "The safest lithium available — solid electrolyte, nail-test safe, 10,000 cycles at 80% DOD. Stackable ABS case with concealed connecting straps.",
      specs: SS_SPECS_12V,
      desc: "Solid-state 12V lithium with double the cycle life of prismatic or cylindrical cells. Safety tests include driving a nail through a cell, 200kN compression, 2× overcharge and a 1-hour dead short. UV-treated ABS case with an internal metal frame designed to stack vertically or sit hard up beside each other; inter-connecting straps conceal into the sides for a clean layout." },

    { id: "tie-down", sku: "STRAP-TIEDOWN", name: "Solid State Battery Tie Down Stainless Frame",
      price: 132.00, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock",
      badges: ["316 Stainless"], short: "Stainless steel tie-down frame to secure a Solid State Lithium stack." },

    { id: "strap-long", sku: "STRAP-SS-LONG", name: "Pair Connecting Straps — Solid State Stack, Long Negative",
      price: 57.75, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock",
      badges: ["Tinned Copper"], short: "Flexible tinned high-grade copper straps for connecting batteries in a stack (long negative)." },

    { id: "strap-short", sku: "STRAP-SS-SHORT", name: "Pair Connecting Straps — Solid State Stack, Short Negative",
      price: 57.75, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock",
      badges: ["Tinned Copper"], short: "Flexible tinned copper straps for connecting batteries in a stack (short negative)." },

    { id: "rs485-1m", sku: "RS485-SS-1M", name: "RS485 Interconnecting Cable 1m — Solid State Batteries",
      price: 26.00, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock", badges: ["8-Pin"],
      short: "8-pin RS485 interconnect cable for Solid State battery comms (1m)." },
    { id: "rs485-3m", sku: "RS485-SS-3M", name: "RS485 Interconnecting Cable 3m — Solid State Batteries",
      price: 39.00, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock", badges: ["8-Pin"],
      short: "8-pin RS485 interconnect cable for Solid State battery comms (3m)." },
    { id: "rs485-4m", sku: "RS485-SS-4M", name: "RS485 Interconnecting Cable 4m — Solid State Batteries",
      price: 61.86, cats: ["12v-lithium", "48v-lithium"], stock: "in_stock", badges: ["8-Pin"],
      short: "8-pin RS485 interconnect cable for Solid State battery comms (4m)." },
    { id: "rs485-65m", sku: "RS485-SS-6M5", name: "RS485 Interconnecting Cable 6.5m — Solid State Batteries",
      price: 69.00, cats: ["12v-lithium"], stock: "in_stock", badges: ["8-Pin"],
      short: "8-pin RS485 interconnect cable for Solid State battery comms (6.5m)." },

    // --- 48V Lithium -------------------------------------------------------
    { id: "ss-48v-1c", sku: "SS-48V-1C", name: "Safiery Solid State Lithium 48V 53.1Ah 2,712Wh",
      price: 2259.60, cats: ["48v-lithium"], stock: "in_stock",
      badges: ["2,712Wh", "5 Year Warranty", "10,000 Cycles"],
      short: "48V solid-state pack, 1C (50A) BMS. Charge & discharge 2,500W.", specs: SS_SPECS_48V,
      desc: "48V solid-state lithium with concealed connecting straps and a CAN Victron-compatible BMS. 1C variant: 50A / 2,500W charge and discharge." },

    { id: "ss-48v-2c", sku: "SS-48V-2C", name: "Safiery Solid State Lithium 48V 53.1Ah 2,712Wh — 2C 5,000W (Bluetooth)",
      price: 2580.00, cats: ["48v-lithium"], featured: true, stock: "in_stock",
      badges: ["2C / 5,000W", "Bluetooth", "5 Year Warranty"],
      short: "48V solid-state pack with a 2C (100A) BMS — 5,000W discharge — and Bluetooth monitoring.",
      specs: Object.assign({}, SS_SPECS_48V, { "Discharge Rate": "100A — 5,000W (2C)", "Bluetooth": "Yes" }),
      desc: "Discharges at 2C (100A at 51.2V). Suits a single 5,000VA inverter, or pairs for 15kW marine electric drive. Patented design with connecting straps concealed into the sides of the case." },

    { id: "ss-48v-3c", sku: "SS-48V-3C", name: "Safiery Solid State Lithium 48V 53.1Ah 2,712Wh — 3C 7,500W",
      price: 2688.00, cats: ["48v-lithium"], featured: true, stock: "in_stock",
      badges: ["3C / 7,500W", "5 Year Warranty", "10,000 Cycles"],
      short: "Top-spec 48V solid-state pack with a 3C (150A) BMS — 7,500W discharge for high-power marine drive.",
      specs: Object.assign({}, SS_SPECS_48V, { "Discharge Rate": "150A — 7,500W (3C)" }),
      desc: "150A / 7,500W discharge. A single pack runs a 5,000VA inverter; multiples scale to 15–40kW marine electric motors." },

    { id: "meteor-48v", sku: "MTR-48V-8K", name: "Meteor 48V 8,000W Power Sealed Safe Lithium Battery",
      price: 2469.60, cats: ["48v-lithium"], stock: "in_stock", badges: ["8,000W", "Sealed"],
      short: "Sealed high-power 48V Meteor lithium battery — 8,000W output." },

    { id: "obc-25a", sku: "OBC-48-25", name: "48V 25A On Board Charger IP67 — Marine / Automotive",
      price: 790.00, cats: ["48v-lithium"], stock: "in_stock", badges: ["IP67", "CAN", "110/240V"],
      short: "48V 25A on-board CAN charger, IP67, 110V or 240V AC input. Marine and automotive grade." },
    { id: "obc-40a", sku: "OBC-48-40", name: "48V 40A On Board Charger IP67 — Marine / Automotive",
      price: 990.00, cats: ["48v-lithium"], stock: "in_stock", badges: ["IP67", "CAN", "110/240V"],
      short: "48V 40A on-board CAN charger, IP67, 110V or 240V AC input. Marine and automotive grade." },

    { id: "meteor-pos-plug", sku: "MTR-POS-MF", name: "Positive Plug with Embedded Mega Fuse for Meteor Lithium",
      price: 152.90, cats: ["48v-lithium", "accessories"], stock: "in_stock", badges: ["Mega Fuse"],
      short: "Positive plug with embedded Mega Fuse for the Meteor lithium battery train." },
    { id: "meteor-neg-plug", sku: "MTR-NEG", name: "Meteor Negative Plug-in Connector",
      price: 42.90, cats: ["48v-lithium", "accessories"], stock: "in_stock",
      short: "Plug-in negative connector for the Meteor lithium battery." },

    { id: "under-chassis", sku: "UC-16665", name: "Stainless Steel Under-Chassis 16,665Wh Battery Container",
      price: 15623.10, cats: ["48v-lithium"], featured: true, stock: "made_to_order",
      badges: ["16,665Wh", "Stainless", "Under-Chassis"],
      short: "Stainless steel under-chassis container housing a 16,272Wh 48V solid-state lithium pack — frees up internal space." },

    // --- Scotty AI DC-DC ---------------------------------------------------
    { id: "scotty-1500-ss", sku: "SCOTTY-1500-SS", name: "SCOTTY AI 1500W Solid State V3 12-48V CANbus Bi-directional DC-DC",
      price: 1989.00, cats: ["scotty", "48v-lithium"], featured: true, stock: "backorder",
      badges: ["AI Powered", "1500W", "Bi-directional", "VE.CAN"],
      short: "Slim-case Scotty AI sized to mount directly on a Solid State battery. AI auto-tunes to your alternator; protects it with a thermal sensor.",
      specs: SCOTTY_SPECS,
      desc: "Scotty AI is an AI-tuned bi-directional DC-DC converter. A two-minute auto-tune maps your alternator's power curve — no programming. A temperature sensor on the alternator housing lets the AI back off (Hard→Medium→Soft) before it overheats. Appears as an alternator on the Victron GUI. This slim-case version mounts on a solid-state battery (battery not included)." },

    { id: "scotty-1500-v3", sku: "SCOTTY-1500-V3", name: "SCOTTY AI 1500W V3 12-48V CANbus Bi-directional DC-DC",
      price: 1989.00, cats: ["scotty"], stock: "in_stock",
      badges: ["AI Powered", "1500W", "Bi-directional", "VE.CAN"],
      short: "Standard-case Scotty AI 1.5kW. AI auto-tune, alternator protection, bi-directional 12/24/36/48V.",
      specs: SCOTTY_SPECS,
      desc: "The standard-enclosure Scotty AI 1500W V3. Charges to the BMS Charge Current Limit on VE.CAN, switches to supply 12V/24V loads in 25ms, and protects the alternator with AI thermal management." },

    { id: "scotty-3kw-1248", sku: "SCOTTY-3K-1248", name: "SCOTTY AI 3kW V3 12-48V — 2× CAN Ports Bi-directional DC-DC",
      price: 3713.00, cats: ["scotty"], featured: true, stock: "in_stock",
      badges: ["AI Powered", "3000W", "2× CAN", "Bi-directional"],
      short: "3kW Scotty AI with two CAN ports for 12-48V systems. Double the power, same AI auto-tune and alternator protection.",
      specs: Object.assign({}, SCOTTY_SPECS, { "Power": "3,000W", "CAN Ports": "2" }),
      desc: "3,000W bi-directional DC-DC for larger 12-48V systems. Two CAN ports allow paralleling and battery-CAN connection. Same patented AI auto-tune and alternator thermal protection as the 1.5kW." },

    { id: "scotty-3kw-2448", sku: "SCOTTY-3K-2448", name: "SCOTTY AI 3kW V3 24-48V — 2× CAN Ports Bi-directional DC-DC",
      price: 4085.37, cats: ["scotty"], stock: "in_stock",
      badges: ["AI Powered", "3000W", "2× CAN", "24-48V"],
      short: "3kW Scotty AI tuned for 24-48V systems, two CAN ports.",
      specs: Object.assign({}, SCOTTY_SPECS, { "Power": "3,000W", "Input / Output": "24V · 48V", "CAN Ports": "2" }),
      desc: "The 24-48V variant of the 3kW Scotty AI for 24V house / starter systems charging a 48V bank." },

    { id: "scotty-upgrade", sku: "SCOTTY-UPG", name: "SCOTTY AI Upgrade from Scotty Ver1 (Most Models)",
      price: 309.75, priceMax: 624.75, variable: true, cats: ["scotty"], stock: "in_stock",
      badges: ["Upgrade"], short: "Upgrade path from Scotty Version 1 to AI on most models. Price varies by model — from AUD309.75." },

    // --- Bi-directional Motor Generators (BMG) -----------------------------
    { id: "bmg-j180-1500", sku: "BMG-J180-1500", name: "48V BMG for J180 Mount — 12V 1500W Auxiliary Power",
      price: 7590.00, cats: ["bmg", "scotty"], featured: true, stock: "in_stock",
      badges: ["10kW", "J180 Mount", "1500W Aux"],
      short: "Bi-directional Motor Generator on a Yanmar J180 mount with an integrated Scotty AI 1500W for 12V auxiliary power. Up to 10kW.",
      desc: "A 48V BMG (alternator) paired with a Scotty AI 1500W producing up to 10kW on a J180 mount, with 12V 1500W auxiliary output." },
    { id: "bmg-j180-3000", sku: "BMG-J180-3000", name: "48V BMG J180 Mount — 12V 3000W Auxiliary Power",
      price: 8970.00, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "J180 Mount", "3000W Aux"],
      short: "48V BMG on a J180 mount with Scotty AI 3000W for 12V auxiliary power." },
    { id: "bmg-volvo-1500", sku: "BMG-VOLVO-1500", name: "48V BMG for Volvo Mount — 12V 1500W Auxiliary Power",
      price: 8082.10, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Volvo Mount", "1500W Aux"],
      short: "48V BMG on a Volvo mount with Scotty AI 1500W for 12V auxiliary power." },
    { id: "bmg-volvo-3000", sku: "BMG-VOLVO-3000", name: "48V BMG Volvo Mount — 12V 3000W Auxiliary Power",
      price: 8970.00, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Volvo Mount", "3000W Aux"],
      short: "48V BMG on a Volvo mount with Scotty AI 3000W for 12V auxiliary power." },
    { id: "bmg-sprinter-1500", sku: "BMG-SPR-1500", name: "48V BMG Sprinter — 12V 1500W Auxiliary Power",
      price: 7590.00, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Sprinter", "1500W Aux"],
      short: "48V BMG for the Mercedes Sprinter with Scotty AI 1500W for 12V auxiliary power." },
    { id: "bmg-sprinter-3000", sku: "BMG-SPR-3000", name: "48V BMG for Sprinter — 12V 3000W Auxiliary Power",
      price: 9806.10, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Sprinter", "3000W Aux"],
      short: "48V BMG for the Mercedes Sprinter with Scotty AI 3000W for 12V auxiliary power." },
    { id: "bmg-pad-1500", sku: "BMG-PAD-1500", name: "48V BMG Pad Mount — Integrated 12V 1500W Auxiliary Power",
      price: 7590.00, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Pad Mount", "1500W Aux"],
      short: "48V BMG pad-mount with an integrated Scotty AI 1500W for 12V auxiliary power, including cabling." },
    { id: "bmg-pad-3000", sku: "BMG-PAD-3000", name: "48V BMG Pad Mount — 12V 3000W Auxiliary Power",
      price: 8970.00, cats: ["bmg", "scotty"], stock: "in_stock",
      badges: ["10kW", "Pad Mount", "3000W Aux"],
      short: "48V BMG pad-mount with a Scotty AI 3000W for 12V auxiliary power." },

    { id: "bmg-pad-pulley", sku: "BMG-PAD-PULLEY", name: "48V BMG Pad Mount Pulley",
      price: 108.90, cats: ["bmg"], stock: "in_stock", short: "Replacement / spare pulley for the 48V BMG pad mount." },
    { id: "bmg-isuzu-1500", sku: "BMG-ISUZU-1500", name: "ISUZU N Series Second 8-10kW BMG 48V — Kit + 1500W DC-DC to 12V",
      price: 9650.00, listPrice: 11699.00, cats: ["bmg"], stock: "in_stock", sale: true,
      badges: ["8-10kW", "ISUZU NPS", "Sale"],
      short: "Second-alternator 8-10kW BMG kit for the ISUZU N Series, including 1500W DC-DC to 12V. On sale." },
    { id: "bmg-isuzu-3000", sku: "BMG-ISUZU-3000", name: "ISUZU N Series Second 8-10kW BMG 48V — Kit + 3000W DC-DC to 24V",
      price: 13950.37, cats: ["bmg"], stock: "in_stock", badges: ["8-10kW", "ISUZU NPS"],
      short: "Second-alternator 8-10kW BMG kit for the ISUZU N Series, including 3000W DC-DC to 24V." },
    { id: "bmg-4804", sku: "BMG-4804", name: "BMG-4804 — J-180 Large Marine Mount (Volvo / Cummins)",
      price: 5665.00, cats: ["bmg"], stock: "in_stock", badges: ["J-180", "Marine"],
      short: "Heavy-duty J-180 large marine mount for the BMG — suits Volvo and Cummins." },
    { id: "bmg-4805", sku: "BMG-4805", name: "BMG-4805 — J-180 Large Marine Mount, Reverse Pivot (Volvo / Cummins)",
      price: 5665.00, cats: ["bmg"], stock: "in_stock", badges: ["J-180", "Reverse Pivot"],
      short: "J-180 large marine mount with reverse pivot orientation — suits Volvo and Cummins." },
    { id: "bmg-4801", sku: "BMG-4801", name: "BMG-4801 — Pad Mount 10kW 48V Alternator",
      price: 5665.00, cats: ["bmg"], stock: "in_stock", badges: ["10kW", "Pad Mount"],
      short: "10kW 48V BMG alternator, pad mount." },

    // --- STAR Digital Switching --------------------------------------------
    { id: "star-power", sku: "STAR-POWER", name: "STAR-Power Wireless 6× 35A + 6× 10A Switching (12V/24V)",
      price: 924.00, cats: ["star-switching"], featured: true, stock: "in_stock",
      badges: ["150A", "Bluetooth", "Victron"],
      short: "Digital switching to 150A with long-range Bluetooth control. Six 35A + six 10A channels, integrates with Victron." },
    { id: "star-rover-4", sku: "STAR-ROVER-4", name: "STAR-Rover-4 Wireless + CAN 4-Channel 15A (12V/24V)",
      price: 409.50, cats: ["star-switching"], stock: "in_stock", badges: ["4× 15A", "CAN/NMEA", "Bluetooth"],
      short: "Four channels of 15A (up to 40A) positive or negative, CAN/NMEA and Bluetooth." },
    { id: "star-light", sku: "STAR-LIGHT", name: "STAR-Light Wireless 12-Channel 10A (12V/24V)",
      price: 892.50, cats: ["star-switching"], stock: "in_stock", badges: ["12× 10A", "Matter", "Victron"],
      short: "Twelve-channel 10A wireless controller with Matter, integrates with Victron." },
    { id: "star-switch-custom", sku: "STAR-CUSTOM", name: "STAR-Switch Custom — 6 Wired Inputs + Logic",
      price: 249.00, cats: ["star-switching", "tank"], stock: "in_stock", badges: ["6 Inputs", "Logic", "Victron"],
      short: "Six wired inputs plus six logic blocks; integrates with Victron and the STAR-Tank radar sensors." },
    { id: "star-tank-fuel", sku: "STAR-TANK-FUEL", name: "STAR-Tank Phased Coherent Radar Fuel Tank Sensor",
      price: 345.45, cats: ["star-switching", "tank"], stock: "in_stock", badges: ["Radar", "Battery", "Victron"],
      short: "Battery-operated phased-coherent radar fuel-tank level sensor, Victron/Cerbo compatible." },
    { id: "star-tank-water", sku: "STAR-TANK-WATER", name: "STAR-Tank Phased Coherent Radar Water Tank Sensor",
      price: 345.45, cats: ["star-switching", "tank"], stock: "in_stock", badges: ["Radar", "Battery", "Victron"],
      short: "Battery-operated phased-coherent radar water-tank level sensor, Victron/Cerbo compatible." },
    { id: "star-sp4", sku: "STAR-SP4", name: "STAR-Switch SP4 Wireless Battery 4-Button Switch",
      price: 206.85, cats: ["star-switching"], stock: "in_stock", badges: ["4 Button", "Wireless"],
      short: "Battery-operated wireless 4-button switch with smart functions." },
    { id: "star-sp4-12v", sku: "STAR-SP4-12V", name: "STAR-Switch SP4 Wireless 4-Button — 12V Supply (always-on backlight)",
      price: 235.00, cats: ["star-switching"], stock: "in_stock", badges: ["4 Button", "12V", "Backlight"],
      short: "SP4 wireless 4-button switch powered from 12V for always-on backlight." },
    { id: "star-quad", sku: "STAR-QUAD", name: "STAR-Switch Quad Wireless Battery 4-Button",
      price: 92.40, cats: ["star-switching"], stock: "in_stock", badges: ["4 Button", "Blue LED"],
      short: "Long-range Bluetooth battery 4-button switch, engraved, blue LED." },
    { id: "star-icon-8", sku: "STAR-ICON-8", name: "STAR-Switch Icon Interchangeable CAN Keypad — 8 Button IP65",
      price: 446.00, cats: ["star-switching"], stock: "in_stock", badges: ["8 Button", "CAN", "IP65"],
      short: "CAN keypad with eight interchangeable icon buttons, IP65." },
    { id: "star-sp8", sku: "STAR-SP8", name: "STAR-Switch SP8 CAN Rubber 8-Button IP67 (custom labels)",
      price: 204.75, cats: ["star-switching"], stock: "in_stock", badges: ["8 Button", "CAN", "IP67"],
      short: "Exterior-grade CAN rubber 8-button keypad, IP67, optional custom labels." },
    { id: "star-icon-12", sku: "STAR-ICON-12", name: "STAR-Switch Icon Interchangeable CAN Keypad — 12 Button IP65",
      price: 595.50, cats: ["star-switching"], stock: "in_stock", badges: ["12 Button", "CAN", "IP65"],
      short: "CAN keypad with twelve interchangeable icon buttons, IP65." },
    { id: "star-demo-system", sku: "STAR-DEMO", name: "STAR Range Demo System Complete — Cerbo + Touch 70",
      price: 3680.95, cats: ["star-switching"], featured: true, stock: "made_to_order",
      badges: ["Demo Board", "Cerbo GX", "Touch 70"],
      short: "Complete powder-coated STAR demo board: STAR-Light, STAR-Switch Custom, Icon & SP8 keypads, STAR-Tank, Ruuvi sensors, LED strips, NMEA2000 backbone, Cerbo GX MK2 and GX Touch 70." },

    // --- STAR Keypad Buttons (interchangeable icons, AUD2 each) -------------
    { id: "btn-aux",          sku: "ICON-AUX",      name: "STAR ICON Button — AUX",           price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: AUX." },
    { id: "btn-awning-in",    sku: "ICON-AWN-IN",   name: "STAR ICON Button — Awning In",     price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Awning In." },
    { id: "btn-awning-light", sku: "ICON-AWN-LT",   name: "STAR ICON Button — Awning Light",  price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Awning Light." },
    { id: "btn-awning-out",   sku: "ICON-AWN-OUT",  name: "STAR ICON Button — Awning Out",    price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Awning Out." },
    { id: "btn-bedroom",      sku: "ICON-BEDRM",    name: "STAR ICON Button — Bedroom Light", price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Bedroom Light." },
    { id: "btn-bedside",      sku: "ICON-BEDSD",    name: "STAR ICON Button — Bedside Light", price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Bedside Light." },
    { id: "btn-blank",        sku: "ICON-BLANK",    name: "STAR ICON Button — Blank",         price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Blank." },
    { id: "btn-canopy",       sku: "ICON-CANOPY",   name: "STAR ICON Button — Canopy Light",  price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Canopy Light." },
    { id: "btn-comp",         sku: "ICON-COMP",     name: "STAR ICON Button — Comp",          price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Comp." },
    { id: "btn-door",         sku: "ICON-DOOR",     name: "STAR ICON Button — Door Light",    price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Door Light." },
    { id: "btn-driver",       sku: "ICON-DRIVER",   name: "STAR ICON Button — Driver Light",  price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Driver Light." },
    { id: "btn-ensuite",      sku: "ICON-ENSUITE",  name: "STAR ICON Button — Ensuite Light", price: 2.00, cats: ["star-buttons"], stock: "in_stock", short: "Interchangeable engraved icon button: Ensuite Light." },

    // --- Tank Monitoring ---------------------------------------------------
    { id: "tank-mfd-kit", sku: "TANK-MFD-KIT", name: "STAR-Tank to MFD Interface Kit (Tee Piece + Terminator)",
      price: 313.00, cats: ["tank"], stock: "in_stock", badges: ["NMEA", "MFD"],
      short: "Interface kit to bring STAR-Tank radar levels onto a marine MFD, with STAR-Switch Custom, tee piece and terminator." },
    { id: "tank-compact-ip65", sku: "TANK-COMP-IP65", name: "Tank Level Sensor COMPACT IP65 (external pressure) 2m lead",
      price: 69.00, cats: ["tank"], stock: "in_stock", badges: ["IP65", "Pressure"],
      short: "Compact external-pressure tank level sensor, IP65, 2m lead." },
    { id: "tank-fuelwater-ip67", sku: "TANK-FW-IP67", name: "Tank Level Sensor Fuel/Water IP67 (external pressure) — 2m range",
      price: 217.00, cats: ["tank"], stock: "in_stock", badges: ["IP67", "Fuel/Water"],
      short: "External-pressure fuel/water tank level sensor, IP67, 2m range." },
    { id: "tank-lpg", sku: "TANK-LPG", name: "LPG Tank Level Magnetic — Victron Cerbo & Simarine compatible",
      price: 168.00, cats: ["tank"], stock: "in_stock", badges: ["LPG", "Magnetic"],
      short: "Magnetic LPG tank level sensor, compatible with Victron Cerbo and Simarine." },
    { id: "tank-gx-140", sku: "GX-TANK-140", name: "GX Tank 140",
      price: 185.90, cats: ["tank"], stock: "in_stock", badges: ["Victron"],
      short: "Victron GX Tank 140 — connect up to four tank senders to a GX device." },
    { id: "tank-wema", sku: "TANK-WEMA", name: "Wema-Style Tank Level Sensor — 304 Stainless",
      price: 89.00, cats: ["tank"], stock: "in_stock", badges: ["304 SS"],
      short: "Wema-style resistive tank level sender in 304 stainless." },
    { id: "tank-ip68", sku: "TANK-IP68", name: "Tank Level Sensor Water IP68 Submersible",
      price: 324.50, cats: ["tank"], stock: "in_stock", badges: ["IP68", "Submersible"],
      short: "Submersible IP68 water tank level sensor." },
    { id: "tank-st107", sku: "TANK-ST107", name: "ST107 Volt / Resistance Module",
      price: 218.00, cats: ["tank"], stock: "in_stock", short: "ST107 voltage / resistance interface module for tank senders." },
    { id: "tank-sender-3", sku: "TANK-SEND-3", name: "Tank Sender Interface — 3 Tanks (sender arm or tank plugs)",
      price: 289.19, cats: ["tank"], stock: "in_stock", badges: ["3 Tanks"],
      short: "Interface for up to three tank senders — sender arm or tank plugs." },

    // --- Smart Induction Cooktops ------------------------------------------
    { id: "cooktop-single", sku: "COOK-1HOB", name: "Safiery Induction Single Hob Cooktop — suits 2000W inverter (no pulsing)",
      price: 249.00, listPrice: 329.00, sale: true, cats: ["cooktops"], featured: false, stock: "in_stock",
      badges: ["2000W", "No Pulsing", "Sale"],
      short: "Single-hob induction cooktop with smooth power and no pulsing — runs cleanly on a 2000W inverter." },
    { id: "cooktop-dual", sku: "COOK-2HOB", name: "Safiery Induction Dual Hob Cooktop — suits 2000W inverter (no pulsing)",
      price: 640.00, listPrice: 899.00, sale: true, cats: ["cooktops"], featured: true, stock: "in_stock",
      badges: ["1800W+1300W", "Schott Ceran", "Sale"],
      short: "Dual-hob induction (1800W + 1300W, limited to 2000W overall) on a 10A plug, with a Schott Ceran crystal top. No pulsing." },
    { id: "cooktop-usa-dual", sku: "COOK-USA-2HOB", name: "Safiery USA Dual Hob Induction Cooktop — 1400W + 1400W, 110V, RV-Safe",
      price: 635.00, listPrice: 890.00, sale: true, cats: ["cooktops"], stock: "in_stock",
      badges: ["1400W×2", "110V", "Sale"],
      short: "Built-in dual induction for 110V markets — 1400W + 1400W to 2000W max, RV-safe, no pulsing." },

    // --- Electric Hot Water ------------------------------------------------
    { id: "hw-12v-8l", sku: "HW-12V-8L", name: "12V Hot Water Tank System 8L 30A — 400W to 70°C",
      price: 490.00, cats: ["hot-water"], stock: "in_stock", badges: ["12V", "8L", "400W"],
      short: "8L 12V hot water tank, 30A / 400W element heating to 70°C." },
    { id: "hw-48v-8l", sku: "HW-48V-8L", name: "48V Hot Water Tank System 8L 1,000W",
      price: 390.00, cats: ["hot-water"], stock: "in_stock", badges: ["48V", "8L", "1000W"],
      short: "8L 48V hot water tank with a 1,000W element for fast recovery." },
    { id: "hw-combo", sku: "HW-COMBO", name: "All-Electric Combo Hot Water — 8L Tank + Instant",
      price: 880.00, cats: ["hot-water"], featured: false, stock: "in_stock", badges: ["8L + Instant"],
      short: "Combination system: an 8L electric tank plus an instant electric booster for continuous hot water." },
    { id: "hw-instant", sku: "HW-INSTANT", name: "Safiery Instant 3000-6000W Hot Water System (no tank)",
      price: 480.00, listPrice: 590.00, sale: true, cats: ["hot-water"], stock: "in_stock",
      badges: ["3-6kW", "Tankless", "Sale"],
      short: "Tankless instant electric hot water, 3000–6000W — no tank needed." },
    { id: "hw-steibel-10l", sku: "HW-STB-10L", name: "Stiebel Electric Fast-Heating Compact 10L Hot Water System",
      price: 459.00, cats: ["hot-water"], stock: "in_stock", badges: ["10L", "Compact"],
      short: "Stiebel Eltron fast-heating compact 10L electric hot water system." },
    { id: "hw-steibel-15l", sku: "HW-STB-15L", name: "Stiebel Electric Fast-Heating Compact 15L Hot Water System",
      price: 560.00, cats: ["hot-water"], stock: "in_stock", badges: ["15L", "Compact"],
      short: "Stiebel Eltron fast-heating compact 15L electric hot water system." },

    // --- Jupiter Canopy Upright Packs --------------------------------------
    { id: "jupiter-a-nobatt", sku: "JUP-A", name: "Jupiter A — 12V 2000W Inverter, 50A DC-DC, 12-Ch Switching (no battery)",
      price: 6420.49, cats: ["jupiter"], stock: "in_stock", badges: ["12V", "2000W", "Victron One Touch"],
      short: "Upright canopy pack: 12V 2000W inverter, 50A DC-DC and 12 channels of Victron One-Touch digital switching. Battery not included." },
    { id: "jupiter-a-200ah", sku: "JUP-A-200", name: "Jupiter A — 12V 2000W, 50A DC-DC, 200Ah Lithium",
      price: 8680.09, cats: ["jupiter"], stock: "in_stock", badges: ["12V", "2000W", "200Ah"],
      short: "Jupiter A pack with 200Ah solid-state lithium built in." },
    { id: "jupiter-b-400ah", sku: "JUP-B-400", name: "Jupiter B — 12V 3000W, 50A DC-DC, 400Ah Lithium",
      price: 11409.39, cats: ["jupiter"], stock: "in_stock", badges: ["12V", "3000W", "400Ah"],
      short: "Jupiter B pack: 12V 3000W inverter, 50A DC-DC, 12-channel switching and 400Ah solid-state lithium." },
    { id: "jupiter-b-nobatt", sku: "JUP-B", name: "Jupiter B — 12V 3000W Inverter, 50A DC-DC, 12-Ch Switching (no battery)",
      price: 6890.19, cats: ["jupiter"], stock: "in_stock", badges: ["12V", "3000W", "Victron One Touch"],
      short: "Jupiter B pack without battery: 12V 3000W inverter, 50A DC-DC and 12-channel switching." },
    { id: "jupiter-c", sku: "JUP-C", name: "Jupiter C — 48V 3000W Inverter, 125A DC-DC, 12-Ch Switching",
      price: 7087.73, cats: ["jupiter"], featured: false, stock: "in_stock", badges: ["48V", "3000W", "125A DC-DC"],
      short: "48V upright canopy pack: 3000W inverter, 125A DC-DC and 12-channel Victron One-Touch switching." },
    { id: "jupiter-d-nobatt", sku: "JUP-D", name: "Jupiter D V2 — 48V 5000W Inverter, 125A DC-DC, 12-Ch Switching (no battery)",
      price: 7764.15, cats: ["jupiter"], stock: "in_stock", badges: ["48V", "5000W", "125A DC-DC"],
      short: "Jupiter D V2: 48V 5000W inverter, 125A DC-DC and 12-channel switching. Battery not included." },
    { id: "jupiter-d-636ah", sku: "JUP-D-636", name: "Jupiter D — 48V 5000W, 125A DC-DC, 636Ah Solid State Lithium",
      price: 14334.03, cats: ["jupiter"], featured: true, stock: "in_stock", badges: ["48V", "5000W", "636Ah"],
      short: "Flagship Jupiter D pack: 48V 5000W inverter, 125A DC-DC, 12-channel switching and a 636Ah solid-state lithium bank." },

    // --- Accessories -------------------------------------------------------
    { id: "led-dual", sku: "LED-DUAL", name: "LED Dual-Colour Alloy Centre Double Diffuser",
      price: 42.90, cats: ["accessories"], stock: "in_stock", badges: ["Dual Colour"],
      short: "Dual-colour LED with an alloy centre and double diffuser." },
    { id: "gpo-rcd", sku: "GPO-RCD", name: "GPO with RCD Built-in",
      price: 190.58, cats: ["accessories"], stock: "in_stock", badges: ["RCD"],
      short: "Mains GPO (power outlet) with built-in RCD protection." },
    { id: "aircon-22000", sku: "AC-22000", name: "Portable Air-Conditioner 22,000 BTU",
      price: 449.00, cats: ["accessories"], stock: "in_stock", badges: ["22,000 BTU"],
      short: "Portable 22,000 BTU air-conditioner for off-grid cabins and vans." },
    { id: "sim-card", sku: "SIM-REMOTE", name: "SIM Card for Remote Monitoring",
      price: 16.50, cats: ["accessories"], stock: "in_stock", badges: ["Data SIM"],
      short: "Data SIM for remote monitoring of your Safiery / Victron system." }
  ];

  // ---- Product documents (manuals / datasheets, mirrored from safiery.com) --
  // PDFs live in assets/docs/. Defined once and shared so a doc is attached to
  // every product it applies to without duplicating titles. `type` drives the
  // sub-label shown under each download link on the product page.
  var DOC = {
    scottyManual:  { title: "Scotty 1500 & 3000 — Installation & Operation Manual (Oct 2025)", file: "scotty-ai-manual-2025.pdf",               type: "manual" },
    scottyTrouble: { title: "Scotty AI — Troubleshooting via Smartphone",                       file: "scotty-ai-troubleshooting-smartphone.pdf", type: "guide" },
    scottyEff:     { title: "Scotty AI — High-Efficiency DC-DC Technical Overview",             file: "scotty-high-efficiency-presentation.pdf",  type: "presentation" },
    scottyBmg:     { title: "Scotty AI V3 & the Bidirectional Motor Generator",                 file: "scotty-ai-v3-and-bmg.pdf",                 type: "datasheet" },
    starManual:    { title: "STAR Range — Operating Manual (V2.3)",                             file: "star-range-operating-manual.pdf",          type: "manual" },
    starTankFuel:  { title: "StarTank Radar Fuel Sensor — Application Note",                    file: "startank-fuel-note.pdf",                   type: "note" },
    victronCerbo:  { title: "Victron Cerbo GX — Manual (Rev 36)",                               file: "victron-cerbo-gx-manual.pdf",              type: "manual" },
    victronMulti:  { title: "Victron MultiPlus-II / Quattro-II — Manual (Rev 11)",              file: "victron-multiplus-ii-quattro-ii-manual.pdf", type: "manual" }
  };

  // id -> documents. Products not listed simply have no published document yet.
  var productDocs = {
    // Scotty AI DC-DC (all V3)
    "scotty-1500-ss": [DOC.scottyManual, DOC.scottyBmg, DOC.scottyEff, DOC.scottyTrouble],
    "scotty-1500-v3": [DOC.scottyManual, DOC.scottyBmg, DOC.scottyEff, DOC.scottyTrouble],
    "scotty-3kw-1248": [DOC.scottyManual, DOC.scottyBmg, DOC.scottyEff, DOC.scottyTrouble],
    "scotty-3kw-2448": [DOC.scottyManual, DOC.scottyBmg, DOC.scottyEff, DOC.scottyTrouble],
    "scotty-upgrade": [DOC.scottyManual],

    // BMG kits that integrate a Scotty AI DC-DC
    "bmg-j180-1500": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-j180-3000": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-volvo-1500": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-volvo-3000": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-sprinter-1500": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-sprinter-3000": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-pad-1500": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-pad-3000": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-isuzu-1500": [DOC.scottyBmg, DOC.scottyManual],
    "bmg-isuzu-3000": [DOC.scottyBmg, DOC.scottyManual],
    // bare alternators / mounts
    "bmg-4804": [DOC.scottyBmg],
    "bmg-4805": [DOC.scottyBmg],
    "bmg-4801": [DOC.scottyBmg],

    // STAR digital switching, keypads & radar sensors
    "star-power": [DOC.starManual],
    "star-rover-4": [DOC.starManual],
    "star-light": [DOC.starManual],
    "star-switch-custom": [DOC.starManual],
    "star-tank-fuel": [DOC.starManual, DOC.starTankFuel],
    "star-tank-water": [DOC.starManual],
    "star-sp4": [DOC.starManual],
    "star-sp4-12v": [DOC.starManual],
    "star-quad": [DOC.starManual],
    "star-icon-8": [DOC.starManual],
    "star-sp8": [DOC.starManual],
    "star-icon-12": [DOC.starManual],
    "star-demo-system": [DOC.starManual, DOC.victronCerbo],

    // Tank monitoring
    "tank-mfd-kit": [DOC.starManual, DOC.starTankFuel],
    "tank-gx-140": [DOC.victronCerbo],

    // Jupiter packs (Victron MultiPlus-II / Quattro-II inverter inside)
    "jupiter-a-nobatt": [DOC.victronMulti],
    "jupiter-a-200ah": [DOC.victronMulti],
    "jupiter-b-400ah": [DOC.victronMulti],
    "jupiter-b-nobatt": [DOC.victronMulti],
    "jupiter-c": [DOC.victronMulti],
    "jupiter-d-nobatt": [DOC.victronMulti],
    "jupiter-d-636ah": [DOC.victronMulti]
  };
  products.forEach(function (p) { if (productDocs[p.id]) p.docs = productDocs[p.id]; });

  var CATALOG = {
    currency: "AUD",
    gstRate: GST_RATE,
    demoPassword: DEMO_PASSWORD,
    b2bTiers: b2bTiers,
    demoAccounts: demoAccounts,
    categories: categories,
    products: products
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CATALOG;
  } else {
    root.SAFIERY_CATALOG = CATALOG;
  }
})(typeof window !== "undefined" ? window : globalThis);
