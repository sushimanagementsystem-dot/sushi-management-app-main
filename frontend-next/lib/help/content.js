/**
 * Every Help / Info explanation in the dashboard, in one place, in plain business language. A "?" icon anywhere in the
 * dashboard points at an entry here by id (see components/dashboard/HelpTip.js), so the wording is written and reviewed
 * once and reads the same everywhere.
 *
 * Every entry was written from what the system actually does today (the calculation in the backend code, the current
 * settings and the current workflow) — not from what a setting's name suggests. When the behaviour changes, change the
 * entry here.
 *
 * Entry fields (all short):
 *   title    what the "?" is about
 *   what     what it is (and why it exists)
 *   why      optional extra on why it exists
 *   how      what it does / how it is worked out
 *   use      how to use it
 *   affects  other pages, settings or calculations it is connected to
 *   note     a caution worth seeing
 *   unused   true = the system never reads this value, so changing it has no effect (checked by help-content.spec.ts)
 *   dormant  true = the system does read it, but with today's value nothing happens (checked by help-content.spec.ts)
 */

const EDIT_ROWS = "Click the pencil on a row to edit it (switches such as Active only respond in edit mode), then press Save at the top.";

/** A setting the system never reads — shown honestly so nobody expects a change to do anything. */
const neverRead = (title, what, note) => ({ title, what, note, unused: true });

export const HELP = {
    // ------------------------------------------------------------------ Overview
    "overview.page": {
        title: "KPI Dashboard",
        what: "A summary of waste, damage, staff food, stocktakes, deliveries and owner actions, for the kiosk and dates you pick.",
        how: "Costs come from what staff logged on the kiosk forms, valued at each product's unit cost. It opens on the last 7 days. The +/- % badge on a cost tile compares with the period of the same length immediately before.",
        use: "Use the kiosk box and date presets at the top. Open the Issues page for a list of what needs attention.",
        affects: ["Product Prices (unit costs)", "Kiosk forms: Morning Waste, Damaged Product, Staff Food"],
    },
    "kpi.waste": {
        title: "Expired / Waste (Finished Product)",
        what: "The cost of finished products (rolls, boxes, meals) that staff threw away because they were out of date, logged in Morning Waste.",
        how: "Units x the product's unit cost. The rate is units binned as a % of the units that were planned for the batches they came from (the day they were made), not the same calendar days. Waste with no plan behind it is left out of the rate. 'Uncosted' items have no unit cost yet, so they can't be valued.",
        use: "A rising rate means more is being made than sold. Give every product a unit cost in Product Prices so nothing is left uncosted.",
        affects: ["Product Prices: Cost", "Production Par (the planned units)", "Settings: Waste Attribution Days (Default) and each product's Shelf Life"],
    },
    "kpi.damage": {
        title: "Damage",
        what: "The cost of finished products that were damaged and logged in the Damaged Product form (a photo is required).",
        how: "Units x the product's unit cost. The rate is damaged units per 100 planned units in the period.",
        use: "Compare kiosks or periods. A kiosk that goes over the Damage Review thresholds automatically appears in your Action Inbox.",
        affects: ["Settings: Damage Review Thresholds", "Action Inbox: Damaged Product", "Product Prices: Cost"],
    },
    "kpi.staffFood": {
        title: "Staff Food",
        what: "The cost of meals staff took, logged in the Staff Food form (one product per person per shift).",
        how: "Each entry is one unit, valued at the product's unit cost. Only products ticked 'Available for Staff Food' can be picked.",
        use: "Watch for unusual cost. Choose what staff can pick in Data Tables > Product.",
        affects: ["Data Tables > Product: Available for Staff Food", "Profit (staff food cost is deducted)"],
    },
    "kpi.totalCost": {
        title: "Total Cost",
        what: "Waste + Damage + Staff Food added together, so you can see the combined cost of product that was not sold.",
        how: "The coloured bar shows which of the three is driving the total. The same three costs are deducted on the Profit page.",
        affects: ["Profit page"],
    },
    "kpi.stocktakeStatus": {
        title: "Stocktake Status",
        what: "How up to date each kiosk's weekly stock count is.",
        how: "FRESH: the last complete stocktake is no older than 'Stocktake Stale After' days (7 by default). STALE: older than that. MISSING: no complete stocktake yet. A stocktake is complete only when every item on the list was counted; 'Incomplete stocktake since' means a newer, unfinished one exists.",
        use: "Chase any kiosk that is STALE or MISSING - ordering, Stock Usage and stock variances all depend on recent counts.",
        affects: ["Settings: Stocktake Stale After", "Stock Usage View (needs confirmed stocktakes)", "Ordering, which is drafted after you confirm stocktakes"],
    },
    "kpi.deliveries": {
        title: "Delivery / Invoice Review Queue",
        what: "The progress of delivery invoices that kiosks have photographed and submitted.",
        how: "The AI reads each invoice into draft lines, then it waits in your Action Inbox. When you confirm it, the goods are added to the kiosk's stock and the approved value counts as cost of goods on the Profit page.",
        use: "Open Action Inbox > Delivery Invoice to check and confirm.",
        affects: ["Action Inbox", "Site Configuration: AI (invoice reading)", "Profit (cost of goods)"],
    },
    "kpi.aiExtraction": {
        title: "AI Extraction",
        what: "How many invoices the AI has not read yet (pending) and how many it could not read (failed).",
        how: "A failed invoice still reaches your Action Inbox, but its lines must be entered by hand.",
        use: "Open the invoice: you can enter the lines, use Re-run AI extraction, or Re-upload image if the photo is missing or unreadable.",
        affects: ["Site Configuration: AI key (a missing or invalid key makes every invoice fail)"],
    },
    "kpi.unmappedLines": {
        title: "Unmapped Invoice Lines",
        what: "Invoice lines that are not yet matched to one of your stock items.",
        how: "Every line needs a stock item before the invoice can be confirmed. The AI matches lines using the supplier codes and descriptions saved in Supplier Items.",
        use: "Pick the stock item on the line in Action Inbox; add the supplier item in Data Tables so it matches automatically next time.",
        affects: ["Data Tables > Supplier Items", "Action Inbox: Delivery Invoice"],
    },
    "kpi.approvedValue": {
        title: "Approved Invoice Value",
        what: "The total of the invoice lines you have approved for the period.",
        how: "It is the 'COGS' (cost of goods) figure on the Profit page, taken from the delivery date's week.",
        affects: ["Profit page"],
    },
    "kpi.ownerActions": {
        title: "Owner Actions",
        what: "The things waiting for you in the Action Inbox.",
        how: "OPEN is new. IN PROGRESS starts automatically the first time you act on it. WAITING FOR OWNER is set by you. The 'all-time by category' tile counts every action ever raised, including finished ones.",
        use: "Go to Action Inbox to work through them.",
        affects: ["Action Inbox"],
    },

    // ---------------------------------------------------------- Kiosk comparison
    "compare.page": {
        title: "Kiosk Comparison",
        what: "Every active kiosk side by side for the same period, so differences stand out.",
        how: "The figures are the same ones as on the KPI Dashboard, laid out one kiosk per row. The Task Completion grid below shows one chosen day.",
        use: "Change the dates at the top. Hover or tap the ? on a column heading for its definition.",
    },
    "compare.wasteCost": {
        title: "Morning Waste Cost",
        what: "The cost of expired finished products binned in Morning Waste during the period.",
        how: "Units x product unit cost. A product with no unit cost yet cannot be valued (counted in the note under the figure). It does not include Food Waste.",
        affects: ["Product Prices: Cost"],
    },
    "compare.wasteRate": {
        title: "Morning Waste Rate %",
        what: "How much of what was made ended up in the bin.",
        how: "Morning-waste units divided by the units planned for the batches they came from (the plan of the day each was made, not of the day it was binned). Waste with no plan behind it is left out.",
        use: "Compare kiosks; small kiosks with few units can swing a lot.",
        affects: ["Production Par (planned units)", "Settings: Waste Attribution Days (Default) and product Shelf Life"],
    },
    "compare.foodWaste": {
        title: "Food Waste",
        what: "Raw stock items (ingredients, packaging) thrown away and logged in the Food Waste form, in grams.",
        how: "Costed only where the item has a Cost per 100g set (Data Tables > Stock Item). It is not part of Morning Waste Cost.",
        affects: ["Data Tables > Stock Item: Cost per 100g and Available for Food Waste"],
    },
    "compare.damageRate": {
        title: "Damage Rate /100",
        what: "Damaged units per 100 planned units in the period.",
        how: "Damaged units divided by planned units, x 100. Shows n/a when there is no production plan for the period.",
        affects: ["Settings: Damage Review Thresholds"],
    },
    "compare.coverage": {
        title: "Coverage",
        what: "A warning that the figures on that row may not be reliable.",
        how: "'no production data' means there were no production plans in the period, so rates can't be worked out. 'no complete stocktake' or 'stale stocktake' means stock figures rest on an old or missing count.",
        use: "Fix the cause (fridge counts not submitted, stocktake overdue) before comparing that kiosk.",
    },
    "tasks.completion": {
        title: "Task Completion",
        what: "Which daily tasks each kiosk has done on the day you choose.",
        how: "Fridge Count, Waste and Staff Food are forms staff submit. Production counts as done when a production plan exists for the day; the plan is created automatically when the fridge count is processed, so a missing Production usually means the fridge count wasn't submitted or failed.",
        use: "Use the arrows to change day. A ticked cell opens what was submitted.",
        affects: ["All Submissions", "Issues (missing tasks are listed there)"],
    },

    // ---------------------------------------------------------------- Stock usage
    "stockUsage.page": {
        title: "Stock Usage",
        what: "The actual amount of each ingredient used at one kiosk between two stocktakes.",
        how: "Opening stock + Deliveries in + Transfers in - Transfers out - Closing stock. Opening and closing are the stock balances at the end of each stocktake day. Only stocktakes you have confirmed in the Action Inbox count. Anything that left stock without being added back - including waste - shows up as usage.",
        use: "Pick a kiosk, then the two stocktakes (the latest two are chosen for you).",
        affects: ["Action Inbox: Stocktake confirmation", "Delivery and transfer records"],
    },

    // ------------------------------------------------------------ Stock variances
    "variances.page": {
        title: "Stock Variances",
        what: "Stock counts that don't match what the system expected - a sign that stock was used, wasted or lost without being logged.",
        how: "Expected = the stock the system says should be there at the end of the count day (every logged delivery, transfer, waste, damage and staff-food record). Actual = what staff counted. Difference = Actual - Expected. Only significant gaps are listed: at least the minimum units AND more than the minimum % of expected (if expected was 0, the unit gap alone decides). Defaults are 5 units and 50%.",
        use: "Look at the biggest differences first. Negative means less on the shelf than expected.",
        affects: ["Settings: Stocktake Variance Threshold (%) and Minimum Units", "Issues (the same rows appear there)", "Action Inbox: confirming a stocktake posts the correcting adjustment, but the variance stays visible here"],
    },

    // ----------------------------------------------------------------- Staff food
    "staffFoodReport.page": {
        title: "Staff Food",
        what: "The staff meals taken, by kiosk, by day and week, and which products.",
        how: "Each entry is one product (one unit) per person per shift, valued at the product's unit cost (products with no cost are shown as not costed). These are the same costs deducted on the Profit page. There is deliberately no per-person breakdown.",
        use: "Use it to spot unusually high staff-meal cost. Control what staff can choose in Data Tables > Product > Available for Staff Food.",
        affects: ["Profit page", "Product Prices: Cost"],
    },

    // --------------------------------------------------------------------- Profit
    "profit.page": {
        title: "Profit",
        what: "Weekly profit for each kiosk (weeks run Monday to Sunday).",
        how: "Total costs = COGS + Waste + Damage + Staff Food + Fixed Costs + Misc Costs. Gross Profit = Sales - Total costs. EBITDA = Gross Profit - Labour. Sales, Fixed Costs and Misc Costs are typed in by you; COGS is your approved delivery invoices; Waste, Damage and Staff Food come from the kiosk forms; Labour comes from the labour report. A dash means it can't be worked out yet (no sales entered, or no labour report).",
        use: "Click a Sales, Fixed Costs or Misc Costs cell to enter that week's figure. Costs you haven't entered count as nothing until you do.",
        affects: ["Action Inbox: confirmed invoices (COGS)", "Product Prices: Cost (values waste, damage and staff food)", "Weekly labour report (below)"],
    },
    "profit.cogs": {
        title: "COGS",
        what: "Cost of goods: what you spent buying stock that week.",
        how: "The total of invoice lines you approved in the Action Inbox, placed in the week of the delivery date.",
        affects: ["Action Inbox: Delivery Invoice"],
    },
    "profit.grossProfit": {
        title: "Gross Profit",
        what: "What is left of the week's sales after all the costs in the table.",
        how: "Sales - (COGS + Waste + Damage + Staff Food + Fixed + Misc). Shows a dash until that week's Sales is entered. Green is a profit, red a loss.",
    },
    "profit.labour": {
        title: "Labour",
        what: "What the kiosk's staff hours cost that week.",
        how: "Comes from the weekly labour report you upload below: hours x the hourly rate you enter (or the sheet's own cost column). Shows a dash when there is no report for that kiosk and week.",
        affects: ["Weekly labour report (below)"],
    },
    "profit.ebitda": {
        title: "EBITDA",
        what: "Profit after labour - the figure to judge a kiosk's weekly trading by.",
        how: "Gross Profit - Labour. Shows a dash until both Sales and the labour report are in.",
    },
    "profit.labourReport": {
        title: "Weekly labour report",
        what: "Loads staff hours from your weekly labour sheet so Labour and EBITDA can be worked out.",
        how: "Upload an Excel or CSV sheet with total hours per kiosk (a template is available). Labour cost = hours x the hourly rate you enter, unless the sheet has its own cost column. 'Week starting' is only used when the sheet has no week column. You see a preview first and nothing is saved until you confirm.",
        use: "Download the template, fill it in, upload, check the preview, then save.",
        affects: ["Profit: Labour and EBITDA columns"],
    },

    // ------------------------------------------------------------ Product prices
    "prices.page": {
        title: "Product Prices",
        what: "The money side of every product: its cost, selling price, recipe cost and packaging cost.",
        how: "Royalty = 30% of the selling price (the franchisor's share). Margin = Selling price - Recipe cost - Packaging cost - Royalty, also shown as a % of the selling price. Only 'Cost' is used to value waste, damage and staff food; recipe and packaging cost are for the margin only.",
        use: "Click the pencil on a row to edit it. A product with no Cost shows as 'uncosted' on the dashboards until you set one.",
        affects: ["KPI Dashboard, Kiosk Comparison, Profit and Staff Food (all value records at Cost)"],
    },
    "prices.cost": {
        title: "Cost (unit cost)",
        what: "What one unit of the product costs you.",
        how: "Waste, Damage and Staff Food records are valued at this. A record made before the cost was set is valued at the cost as it is now.",
        affects: ["KPI Dashboard", "Kiosk Comparison", "Profit", "Staff Food"],
    },
    "prices.royalty": {
        title: "Royalty",
        what: "The franchisor's share of each sale.",
        how: "30% of the selling price, taken off every product's margin.",
    },
    "prices.margin": {
        title: "Margin",
        what: "What you keep from one sale of the product.",
        how: "Selling price - Recipe cost - Packaging cost - Royalty; the % is that profit divided by the selling price. Red means a loss on every unit sold.",
        note: "Blank until there is a selling price and at least a recipe or packaging cost.",
    },
    "prices.stockItems": {
        title: "Stock Items / Ingredients",
        what: "One price per stock item - exactly the items on the Weekly Stocktake, shared by both brands.",
        how: "The price is used to value stock movements (deliveries, transfers, stocktake adjustments). Food Waste is valued separately using Cost per 100g in Data Tables > Stock Item.",
        affects: ["Data Tables > Stock Item", "Stock Usage and stock value figures"],
    },

    // -------------------------------------------------------------------- Reports
    "reports.page": {
        title: "Reports",
        what: "The dashboard's reports in one place, for a day, week or month.",
        how: "Most reports reuse the figures from the other pages (Kiosk Comparison, Profit, Stock Variances, Staff Food), so they always agree. Production and Trends are the two that exist only here.",
        use: "Choose the period, then download a CSV or email a report to yourself.",
        note: "Emailing needs the email account set up in Site Configuration > SMTP Connection.",
        affects: ["Site Configuration: SMTP Connection"],
    },
    "reports.production": {
        title: "Production report",
        what: "How many units were planned for each product in the period, side by side for each kiosk.",
        how: "It adds up the daily production plans (today's Production Par target minus the fridge count). It shows what was planned, not what was actually sold.",
        affects: ["Production Par", "Fridge Count submissions"],
    },
    "reports.trends": {
        title: "Trends",
        what: "Day-by-day waste, damage and staff-food cost across all kiosks, so you can see whether things are getting better or worse.",
        how: "Adds up the cost saved on each record for that day. A record with no cost saved counts as 0 here, so a day can look lower than the same figures on the KPI Dashboard, which values those records at the product's current cost.",
        affects: ["Product Prices: Cost"],
    },

    // ---------------------------------------------------------------------- Issues
    "issues.page": {
        title: "Issues",
        what: "One list of everything that is wrong right now across the kiosks, so you don't have to check each page.",
        how: "Three kinds: (1) a daily task not submitted (Fridge Count, Waste, Staff Food, Production) on the last day of the range; (2) stock variances from stocktakes in the range; (3) a waste or damage rate clearly above that kiosk's own usual level - the last 7 finished days compared with the 28 before, and only with enough volume (100+ planned units, 5+ units wasted), at least 1.5x and 2 points higher, and beyond normal week-to-week swings. The list is worked out live: an item disappears when its cause is fixed.",
        use: "Pick Today, Yesterday, This week or All time. 'Yesterday' shows what was missing or out of line yesterday.",
        affects: ["Task Completion", "Stock Variances", "Kiosk forms"],
    },

    // ---------------------------------------------------------------- Action Inbox
    "inbox.page": {
        title: "Action Inbox",
        what: "Everything staff have sent that needs your decision: invoices, stock transfers, stocktakes, damage reports, help requests, audits and corrections.",
        how: "A card is created automatically when staff submit the form. OPEN becomes IN PROGRESS the first time you act on it, and RESOLVED when its review is complete. WAITING FOR OWNER, CLOSED and NOT PROCEEDING are set by you and are never changed automatically. A card still open past its due date is marked overdue.",
        use: "Filter by status, category, priority or kiosk, then click a card to review it. 'Draft orders' sends you the supplier order emails now.",
        affects: ["Overview: Owner Actions", "Supplier orders (emailed to you)"],
    },
    "inbox.INVOICE_REVIEW": {
        title: "Delivery Invoice review",
        what: "A supplier invoice the kiosk photographed, read by AI into draft lines for you to check.",
        how: "Check each line's stock item, quantity and cost (edit if needed) and press Confirm: the lines are added to the kiosk's stock as a delivery and count as cost of goods on Profit. Undo puts the invoice back in review and removes what it posted. Decline posts nothing.",
        use: "If a page image is missing or unreadable, use Re-upload image (the old image is kept as a previous version), then Re-run AI extraction. Re-running only replaces untouched AI draft lines, never ones you typed or corrected.",
        affects: ["Profit (COGS)", "Stock levels and ordering", "Site Configuration: AI"],
    },
    "inbox.DAMAGE_REVIEW": {
        title: "Damaged Product review",
        what: "A damage report with photo that has crossed one of the damage thresholds.",
        how: "A card is only raised when a kiosk's damage over the last 7 days, one product's damaged units, or one person's number of damage reports passes the limits in Settings > Damage Review Thresholds. Press OK once you have looked at it.",
        affects: ["Settings: Damage Review Thresholds"],
    },
    "inbox.HELP_ISSUE": {
        title: "Help / Issue",
        what: "A kiosk issue, request for help or feedback sent by staff.",
        how: "Each type gets a default due date: Kiosk Issue 3 days, Help Needed 7 days, Feedback 14 days (Settings > Help / Issue Deadlines). Set the status and priority as you work on it.",
        affects: ["Settings: Help / Issue Deadlines"],
    },
    "inbox.AUDIT_REVIEW": {
        title: "Monthly Audit review",
        what: "A kiosk's Monthly Audit for you to mark, question by question.",
        how: "Accept keeps the staff answer; Override changes it to Pass or Fail; Evidence insufficient counts as a fail. A note is required when you override to Fail or mark evidence insufficient. Each fail creates a corrective action for the kiosk, due in 2 days if the question is critical, otherwise 7. When every answer is reviewed the score is the weighted % of questions passed (N/A excluded): at or above the pass mark (90% by default) is PASS, at or above the attention mark (80%) is ATTENTION, below that ACTION REQUIRED.",
        affects: ["Settings: Monthly Audit thresholds and deadlines", "Audit Corrections (kiosk form)", "Final Audit Result page"],
    },
    "inbox.AUDIT_CORRECTION_REVIEW": {
        title: "Audit Correction review",
        what: "Staff's fix and replacement photo for a question that failed the audit.",
        how: "Accept closes the corrective action for good. Reject sends it back to the kiosk to try again - no reason is sent with it, so tell them separately. The audit's final score is not recalculated.",
        affects: ["Monthly Audit review", "Final Audit Result page"],
    },
    "inbox.TRANSFER_APPROVAL": {
        title: "Stock Transfer",
        what: "A kiosk's request to move stock to or from another kiosk. Nothing moves until you approve and apply it.",
        how: "Approve needs both kiosks filled in (fix a 'not sure' one with Edit first). Apply then posts the stock going out of the source and into the destination. Decline stops it. Newer requests include the kiosk's photo of what is being moved.",
        affects: ["Stock levels at both kiosks", "Stock Usage View"],
    },
    "inbox.STOCKTAKE_REVIEW": {
        title: "Stocktake review",
        what: "A kiosk's weekly stock count for you to confirm.",
        how: "Confirm compares every count with the system's stock at the end of that day and posts an adjustment for each difference, so the system's stock now equals the count. Decline leaves stock unchanged. Once the last waiting kiosk is confirmed, the supplier orders are drafted and emailed to you.",
        affects: ["Stock Variances", "Stock Usage View", "Purchasing recommendations"],
    },
    "inbox.PURCHASING_RECOMMENDATION": {
        title: "Purchasing recommendation",
        what: "A drafted order for one supplier, worked out from the latest confirmed stocktakes.",
        how: "For each item, if the stock is at or below its Minimum (or its Target if no minimum is set), it orders up to Target + Safety stock, rounded up to whole cases and the supplier's order multiple. Kiosk shortfalls are added together. The draft is emailed to you, never sent to the supplier. MANUAL suppliers are never ordered automatically, and Castlebay is always a fixed 4 packs per kiosk that triggers. Items with no par level or supplier are listed as needing set-up.",
        affects: ["Data Tables: Stock Item Par, Supplier and Supplier Items", "Confirmed stocktakes"],
    },
    "inbox.OTHER": {
        title: "Other item",
        what: "A general item that doesn't belong to one of the specific review types.",
        use: "Open it and set its status when you have dealt with it.",
    },

    // ---------------------------------------------------------------- Audit result
    "auditResult.page": {
        title: "Final Audit Result",
        what: "The finished, shareable record of one Monthly Audit: score, photos and the corrections required.",
        how: "Score = weighted % of questions passed after your review (N/A excluded). At or above the pass mark (90% by default) is PASS, at or above the attention mark (80%) is ATTENTION, below that ACTION REQUIRED - both marks are in Settings. Corrections lists the failed questions with their deadline and whether they are closed.",
        affects: ["Settings: Monthly Audit", "Action Inbox: Audit review and corrections"],
    },

    // ------------------------------------------------------------------- Settings
    "settings.page": {
        title: "Settings",
        what: "The numbers the system uses to plan production, judge stock, and set audit and deadline rules.",
        how: "A change applies from the next calculation onward; past records are not changed. A setting marked 'No effect today' is shown but the system does not currently read it.",
        use: "Press Edit, change values, then Save. Hover or tap the ? beside a setting to see exactly what it changes.",
        note: "Ask before changing rice and batching settings: they change how much rice the kiosks are told to cook each day.",
    },
    "settings.rice": {
        title: "Rice & Batching",
        what: "How the daily production plan turns the products staff need to make into sushi rice to cook.",
        how: "Each roll, maki and nigiri is converted to grams of seasoned rice; the total is divided by the batch yield and rounded up to whole batches. Only Primary products decide the batch count; Secondary products are made from what is left over.",
        affects: ["Production email sent to each kiosk", "Data Tables: Component and Recipe Component"],
    },
    "settings.componentBatching": {
        title: "Component Batching",
        what: "Rules for products prepared in fixed-size packs.",
        how: "Currently the Prawn Katsu roll, which is prepared in whole bags.",
        affects: ["Production email"],
    },
    "settings.secondary": {
        title: "Secondary Item Allocation",
        what: "How leftover sushi rice is shared between Secondary products after the Primary products are covered.",
        how: "Secondary products are added one at a time to whichever has been made least (then least recently) over the lookback window, until the spare rice is used.",
        affects: ["Data Tables > Product: Production Role", "Production email"],
    },
    "settings.foodWaste": {
        title: "Food Waste Packaging",
        what: "Decides which stock category the Food Waste form shows under PACKAGING.",
        how: "The Food Waste list is the same list as the Weekly Stocktake; which items appear is controlled by 'Available for Food Waste' on each Stock Item. Everything not in the packaging category shows as FOOD.",
        affects: ["Kiosk Food Waste form", "Data Tables > Stock Item"],
    },
    "settings.sampling": {
        title: "Sampling",
        what: "Extra sushi and karaage the kiosks are told to prepare for customer sampling on set days.",
        how: "On the chosen days the production email adds the sampling quantities to the day's prep.",
        affects: ["Production email"],
    },
    "settings.defrostWaste": {
        title: "Defrost & Waste Attribution",
        what: "Settings about how waste is matched back to the day the product was made.",
        how: "Waste is matched to the batch made 'shelf life' days earlier, so waste rates compare like with like.",
        affects: ["Waste rate on KPI Dashboard, Kiosk Comparison and Issues"],
    },
    "settings.damage": {
        title: "Damage Review Thresholds",
        what: "When a damage report should reach your Action Inbox for review.",
        how: "Every damage report is recorded. A review card is created only if any one of the three limits below is reached.",
        affects: ["Action Inbox: Damaged Product"],
    },
    "settings.stocktake": {
        title: "Stocktake",
        what: "When a stocktake counts as out of date and when a change in a count is worth flagging.",
        affects: ["KPI Dashboard: Stocktake Status", "Stock Variances", "Issues", "Ordering"],
    },
    "settings.audit": {
        title: "Monthly Audit",
        what: "The pass marks for the Monthly Audit and how long kiosks have to fix a failed question.",
        affects: ["Action Inbox: Audit review", "Final Audit Result page", "Audit Corrections (kiosk form)"],
    },
    "settings.deadlines": {
        title: "Help / Issue Deadlines",
        what: "The default number of days to deal with each type of request kiosks send from the Help / Issues form.",
        how: "Sets the due date on the card in your Action Inbox when the request arrives. Urgent requests have no default deadline.",
        affects: ["Action Inbox: Help / Issue"],
    },
    "settings.purchasing": {
        title: "Purchasing & Products",
        what: "A few product and ordering choices used by the production email and supplier orders.",
    },

    // Rice & batching
    "setting.RICE_BATCH_SEASONED_YIELD_G": {
        title: "Seasoned Rice Yield per Batch",
        what: "How many grams of ready-to-use sushi rice one standard batch produces.",
        how: "Batches to cook = the sushi rice the Primary products need, divided by this and rounded up. Batches x this is the total available; whatever the Primary products don't use goes to Secondary products.",
        affects: ["Production email (rice batches)", "Secondary Item Allocation"],
    },
    "setting.RICE_NO_COOK_THRESHOLD_G": {
        title: "No-Cook Threshold",
        what: "The smallest amount of sushi rice worth cooking a batch for.",
        how: "If the Primary products need less rice than this, no batch is cooked that day. Secondary products alone never trigger a batch.",
        affects: ["Production email"],
    },
    "setting.RICE_PER_FULL_ROLL_G": {
        title: "Rice per Full Roll",
        what: "Grams of seasoned rice in one full roll.",
        how: "Used to convert the roll pieces the plan needs into grams of rice. Pieces are turned into rolls using each component's 'Units per Prep Unit'.",
        affects: ["Rice batches in the production email", "Data Tables > Component"],
    },
    "setting.RICE_PER_MAKI_G": {
        title: "Rice per Full Maki",
        what: "Grams of seasoned rice in one full maki.",
        how: "Used to convert the maki pieces the plan needs into grams of rice.",
        affects: ["Rice batches in the production email", "Data Tables > Component"],
    },
    "setting.RICE_PER_NIGIRI_G": {
        title: "Rice per Nigiri Piece",
        what: "Grams of seasoned rice under one nigiri piece.",
        how: "Nigiri pieces needed x this = grams of rice.",
        affects: ["Rice batches in the production email"],
    },
    "setting.PLAIN_RICE_BATCH_YIELD_G": {
        title: "Plain Rice Cooked Yield",
        what: "How many grams of cooked plain rice one 1 kg (dry) batch makes.",
        how: "Plain-rice batches = the plain rice needed (after taking off yesterday's leftover typed on the Fridge Count) divided by this, rounded up.",
        affects: ["Production email (plain rice)", "Fridge Count: leftover plain rice"],
    },
    "setting.RICE_PER_BOWL_G": {
        title: "Rice per Bowl",
        what: "Grams of cooked plain rice in one rice bowl.",
        how: "Used to work out how many bowls of plain rice are needed, and whether that is enough to be worth cooking a batch.",
        affects: ["Production email (plain rice)"],
    },
    "setting.PLAIN_RICE_MIN_PORTIONS": {
        title: "Minimum Portions for a Plain Rice Batch",
        what: "The fewest bowls of plain rice worth cooking a separate batch for.",
        how: "If fewer bowls than this are needed, no plain-rice batch is cooked and the production email tells staff to use the substitute products instead.",
        affects: ["Rice Bowl Substitute Products", "Production email"],
    },
    // Component batching
    "setting.PRAWN_KATSU_ROLLS_PER_BAG": {
        title: "Prawn Katsu Rolls per Bag",
        what: "How many prawn katsu rolls one bag makes.",
        how: "The plan rounds the prawn katsu rolls to whole bags, trimming or topping up Secondary products so an opened bag is fully used.",
        affects: ["Production email (prawn katsu prep)"],
    },
    "setting.PRAWN_KATSU_COMPONENT_ID": {
        title: "Prawn Katsu Roll Component",
        what: "Tells the system which prep component is the prawn katsu roll.",
        how: "The bag rounding above is applied to this component. It should point at the Prawn Katsu Roll component.",
        note: "Only change this if the component itself has been replaced.",
        affects: ["Data Tables > Component"],
    },
    // Secondary allocation
    "setting.SECONDARY_HISTORY_LOOKBACK_DAYS": {
        title: "Secondary Rotation Lookback",
        what: "How many recent days are looked at to keep Secondary products fairly rotated.",
        how: "Products made least in this window (then least recently) get the leftover rice first, so the same product isn't always chosen.",
        affects: ["Data Tables > Product: Production Role (Secondary)", "Production email"],
    },
    "setting.SANDO_STEP_PRODUCT_IDS": {
        title: "Sando-style Products",
        what: "A list of products where one preparation makes more than one sale box. Reserved for a Sando product.",
        how: "Listed products are then planned in multiples of 'Sando Sale-Boxes per Prep Unit'. The list is empty, and no product on the menu is a Sando, so nothing changes today.",
        dormant: true,
        note: "Leave blank unless a multi-box product is added to the menu.",
    },
    "setting.SANDO_UNITS_PER_PREP": {
        title: "Sando Sale-Boxes per Prep Unit",
        what: "How many sale boxes one preparation makes for the products in the Sando list.",
        how: "Only applies to products listed in 'Sando-style Products', which is empty.",
        dormant: true,
    },
    // Food waste
    "setting.FOOD_WASTE_PACKAGING_CATEGORIES": {
        title: "Food Waste - Packaging Categories",
        what: "Which stock categories are shown as PACKAGING (rather than FOOD) in the Food Waste form.",
        how: "Currently the Drystore - Packaging category. Every other category on the Stocktake list shows as FOOD. Which items appear at all is set by 'Available for Food Waste' on each Stock Item.",
        affects: ["Kiosk Food Waste form", "Data Tables > Stock Item"],
    },
    // Sampling
    "setting.SAMPLING_DAYS": {
        title: "Sampling Days",
        what: "The weekdays customers are offered samples.",
        how: "On these days the production email adds the sampling sushi and karaage to the day's prep.",
        affects: ["Sampling Sushi Selection", "Sampling Karaage per Flavour", "Production email"],
    },
    "setting.SAMPLING_SUSHI": {
        title: "Sampling Sushi Selection",
        what: "Which sushi components to prepare for sampling, and how many of each.",
        how: "Added to the rice and prep quantities on the Sampling Days. Pick the component by name from the list.",
        affects: ["Sampling Days", "Production email", "Data Tables > Component"],
    },
    "setting.SAMPLING_KARAAGE_PER_FLAVOUR": {
        title: "Sampling Karaage per Flavour",
        what: "How many karaage pieces to set aside for sampling, for each flavour being made.",
        how: "On Sampling Days: this number x the karaage flavours being made that day is added to the karaage count.",
        affects: ["Sampling Days", "Production email"],
    },
    // Defrost & waste attribution
    "setting.WASTE_ATTRIBUTION_DAYS_DEFAULT": {
        title: "Waste Attribution Days (Default)",
        what: "How many days before it was binned a product is assumed to have been made.",
        how: "Used for products that have no Shelf Life set in Data Tables > Product. The bin date minus this many days is the batch the waste is matched to when working out waste rates.",
        use: "Set a Shelf Life on a product to override this for that product.",
        affects: ["Waste rate on KPI Dashboard, Kiosk Comparison and Issues", "Data Tables > Product: Shelf Life"],
    },
    // Damage
    "setting.DAMAGE_REVIEW_UNITS_PER_100": {
        title: "Damage Review Rate Threshold",
        what: "The damage rate that triggers a review.",
        how: "If a kiosk's damaged units in the last 7 days go above this many per 100 planned units, a Damaged Product review card is created.",
        affects: ["Action Inbox: Damaged Product"],
    },
    "setting.DAMAGE_REVIEW_PRODUCT_WEEK_UNITS": {
        title: "Damage Review Threshold (per Product)",
        what: "How many damaged units of one product in a week trigger a review.",
        how: "When one product reaches this many damaged units in the last 7 days at a kiosk, a review card is created.",
        affects: ["Action Inbox: Damaged Product"],
    },
    "setting.DAMAGE_REVIEW_SUBMITTER_WEEK": {
        title: "Damage Review Threshold (per Submitter)",
        what: "How many damage reports by the same person in a week trigger a review.",
        how: "When one person has submitted this many damage reports in the last 7 days, a review card is created.",
        affects: ["Action Inbox: Damaged Product"],
    },
    // Stocktake
    "setting.STOCKTAKE_STALE_DAYS": {
        title: "Stocktake Stale After",
        what: "How many days old a kiosk's last complete stocktake can be before it is called STALE.",
        how: "Drives the FRESH / STALE label on the KPI Dashboard and Kiosk Comparison, and marks lines in drafted supplier orders whose stock count is older than this.",
        affects: ["KPI Dashboard: Stocktake Status", "Kiosk Comparison: Coverage", "Purchasing recommendations"],
    },
    "setting.STOCKTAKE_VARIANCE_PCT": {
        title: "Stocktake Variance Threshold (%)",
        what: "How big a change in a count must be, in %, to be flagged as significant.",
        how: "Used in two places: when a kiosk submits a stocktake (an item that moved by more than this % since the last count is flagged), and on the Stock Variances page (the gap between expected and counted must exceed this % of expected). It must also reach the Minimum Units.",
        affects: ["Stock Variances", "Issues", "Weekly stocktake submissions"],
    },
    "setting.STOCKTAKE_VARIANCE_MIN_UNITS": {
        title: "Stocktake Variance Minimum Units",
        what: "The smallest change in a count, in units, worth flagging.",
        how: "A change is only flagged if it is at least this many units AND over the variance %. If the expected stock was 0, this number alone decides.",
        affects: ["Stock Variances", "Issues", "Weekly stocktake submissions"],
    },
    // Audit
    "setting.AUDIT_PASS_PCT": {
        title: "Audit Pass Threshold",
        what: "The score an audit needs to be rated PASS.",
        how: "Once every answer is reviewed, a score at or above this is PASS.",
        affects: ["Audit review and Final Audit Result"],
    },
    "setting.AUDIT_ATTENTION_PCT": {
        title: "Audit Attention Threshold",
        what: "The score below which an audit is rated ACTION REQUIRED.",
        how: "At or above this (but under the Pass threshold) is ATTENTION; below it is ACTION REQUIRED.",
        affects: ["Audit review and Final Audit Result"],
    },
    "setting.AUDIT_CORRECTION_DAYS": {
        title: "Audit Correction Deadline",
        what: "How many days a kiosk has to fix a failed, non-critical audit question.",
        how: "Set as the deadline when you mark a question as failed. Kiosks see the deadline on their Audit Corrections page.",
        affects: ["Audit Corrections (kiosk form)"],
    },
    "setting.AUDIT_CRITICAL_CORRECTION_DAYS": {
        title: "Audit Critical Correction Deadline",
        what: "How many days a kiosk has to fix a failed CRITICAL audit question.",
        how: "Same as the standard deadline, but for questions marked Critical in Data Tables > Audit Question.",
        affects: ["Audit Corrections (kiosk form)", "Data Tables > Audit Question"],
    },
    // Deadlines
    "setting.REQUEST_DEADLINE_KIOSK_ISSUE_DAYS": {
        title: "Kiosk Issue Deadline",
        what: "Default days to resolve a 'Kiosk Issue' request.",
        how: "Sets the due date on the Action Inbox card when the request arrives.",
        affects: ["Action Inbox: Help / Issue"],
    },
    "setting.REQUEST_DEADLINE_HELP_DAYS": {
        title: "Help Needed Deadline",
        what: "Default days to respond to a 'Help Needed' request.",
        how: "Sets the due date on the Action Inbox card when the request arrives.",
        affects: ["Action Inbox: Help / Issue"],
    },
    "setting.REQUEST_DEADLINE_FEEDBACK_DAYS": {
        title: "Feedback Deadline",
        what: "Default days to respond to a 'Feedback' request.",
        how: "Sets the due date on the Action Inbox card when the request arrives.",
        affects: ["Action Inbox: Help / Issue"],
    },
    // Purchasing & products
    "setting.KARAAGE_BALANCING_PRODUCT": {
        title: "Karaage Balancing Product",
        what: "The product that takes up leftover karaage pieces when a bag is opened.",
        how: "Used in the production email's karaage note when pieces are left over after the day's karaage products are covered.",
        affects: ["Production email"],
    },
    "setting.RICE_BOWL_SUBSTITUTES": {
        title: "Rice Bowl Substitute Products",
        what: "The products staff are told to make instead of rice bowls when too little plain rice is needed to cook a batch.",
        how: "Shown in the production email when the plain rice needed is below 'Minimum Portions for a Plain Rice Batch'.",
        affects: ["Minimum Portions for a Plain Rice Batch", "Production email"],
    },

    // Values shown on the Settings page that the system never reads.
    "setting.RICE_BATCH_DRY_G": neverRead("Dry Rice per Batch", "Records the dry rice in a standard batch.", "The plan doesn't use this figure. The batch size it works from is 'Seasoned Rice Yield per Batch'."),
    "setting.RICE_BATCH_COOKED_PLAIN_G": neverRead("Cooked Plain Rice per Batch", "Records the cooked plain rice before seasoning.", "The plan doesn't use this figure."),
    "setting.RICE_BATCH_VINEGAR_G": neverRead("Vinegar Seasoning per Batch", "Records the vinegar seasoning per batch.", "The plan doesn't use this figure."),
    "setting.FULL_ROLL_PIECES": neverRead("Pieces per Full Roll", "Records how many pieces make a full roll.", "The plan doesn't read this. It converts pieces to rolls using each component's 'Units per Prep Unit' in Data Tables > Component."),
    "setting.MAKI_PIECES": neverRead("Pieces per Full Maki", "Records how many pieces make a full maki.", "The plan doesn't read this. It converts pieces to maki using each component's 'Units per Prep Unit' in Data Tables > Component."),
    "setting.PLAIN_RICE_BATCH_DRY_G": neverRead("Plain Rice Batch Size (g dry)", "Records the dry rice in a plain rice batch.", "The plan doesn't use this figure. It uses 'Plain Rice Cooked Yield' and works in 1 kg batches."),
    "setting.PLAIN_RICE_REMAINDER_MIN_G": neverRead("Minimum Remainder for an Extra Bowl", "Records a rule for counting a small remainder as an extra bowl.", "The plan doesn't apply this rule."),
    "setting.LOW_VOLUME_COMBINED_TARGET": neverRead("Low-Volume Combined Target", "Records a target for low-volume days when some bowls are left out.", "The plan doesn't use this figure."),
    "setting.DEFROST_MEDIAN_WEEKS": neverRead("Defrost Guidance Lookback", "Records how many past weeks a defrost suggestion could look back over.", "The defrost list in the production email is worked out from Production Par, recipes and Defrost Par - it doesn't use this figure."),
    "setting.WASTE_ATTRIBUTION_DAYS_KCRB": neverRead("Waste Attribution Days (Korean Chicken Rice Bowl)", "Records a separate waste-matching period for this one product.", "The system doesn't read this. To give that product its own period, set its Shelf Life in Data Tables > Product."),
    "setting.CASTLEBAY_SALMON_ORDER_BOXES": neverRead("Castlebay Salmon Order Size", "Records how many boxes to order from Castlebay.", "Changing this does nothing. The system always orders 4 boxes per triggered kiosk for Castlebay - that number is built into the system."),

    // -------------------------------------------------------------- Site configuration
    "site.page": {
        title: "Site Configuration",
        what: "Connections the whole system uses: outbound email and the AI that reads invoices.",
        how: "Passwords and API keys are stored encrypted and never shown again after saving. Each card has an on/off switch.",
        affects: ["Production emails, supplier order drafts, emailed reports", "Delivery invoice reading"],
    },
    "site.admin": {
        title: "Admin",
        what: "The owner's email address, stored for reference.",
        note: "Nothing in the system reads this address at the moment. Supplier order drafts go to every active Admin in Data Tables > Staff, and each kiosk's production email goes to that kiosk's own Production Email.",
        affects: ["Data Tables > Staff (Admin role)", "Data Tables > Kiosk: Production Email"],
        dormant: true,
    },
    "site.ai": {
        title: "AI - Claude (invoice reading)",
        what: "The key that lets the system read invoice photos and turn them into draft lines.",
        how: "Without a working key every invoice still arrives in your Action Inbox, but its lines must be typed in. The model choice trades cost for accuracy. Turning the card off ignores the saved key (a server-level key is used if one exists).",
        use: "Paste the key once and Save; leave the box blank later to keep it. Use Re-run AI extraction on invoices that failed while the key was wrong.",
        affects: ["Action Inbox: Delivery Invoice", "KPI Dashboard: AI Extraction"],
    },
    "site.smtp": {
        title: "SMTP Connection",
        what: "The email account the system sends its email from.",
        how: "Used for each kiosk's daily production plan, supplier order drafts sent to you, and reports you email from the Reports page. If it is off or incomplete, no email is sent (orders are still drafted in the Action Inbox and the failure is noted on them). Port 465 uses 'TLS from connect'; leave it off for port 587.",
        use: "Fill in the details, Save, then use the Test Connection card below to check it works.",
        affects: ["Production email", "Supplier orders", "Reports: email"],
    },

    // ------------------------------------------------------------------ Upload data
    "upload.page": {
        title: "Upload Data",
        what: "Updates the whole system from an Excel workbook in one go - the same workbook format as the original handover file.",
        how: "Each sheet is one table. Rows are matched by their ID: existing rows are updated, new rows are added and nothing is deleted. A sheet with errors reports them row by row, and tables that already synced don't need repeating.",
        use: "Use Download Data to get a current workbook, edit it, and upload it back. For a single list (prices, par levels, production par) the 'Bulk update' buttons in Data Tables are safer: they show a preview first.",
        note: "This changes live data straight away.",
        affects: ["Every Data Table"],
    },

    // ------------------------------------------------------------------ Data tables
    "tables.page": {
        title: "Data Tables",
        what: "The system's master lists: products, stock items, kiosks, suppliers, staff and more. Changes here flow through the whole system.",
        use: EDIT_ROWS,
        affects: ["Every form, calculation and report that reads these lists"],
    },
    "tables.bulk": {
        title: "Bulk update",
        what: "Change many rows at once in a spreadsheet instead of one by one.",
        how: "Download the template (it already contains today's values), edit it in Excel, upload it and check the preview. Nothing is saved until you press Apply. If any row has a problem, nothing at all is applied. Blank cells are left unchanged.",
        use: "Fix the problems the preview lists, upload again, then Apply.",
    },
    "tables.kiosk": {
        title: "Kiosk",
        what: "The kiosk locations and how each one connects to the system.",
        how: "The Token is the secret in the kiosk's link that lets its tablet open the staff forms - treat it like a password. Production Email is where that kiosk's daily production plan is sent. Turning Active off removes a kiosk from every dashboard and form.",
        use: EDIT_ROWS,
        affects: ["Production email", "Every dashboard page"],
    },
    "tables.product": {
        title: "Product",
        what: "The finished products kiosks make or sell.",
        how: "Production Role decides how the daily plan treats it; Shelf Life matches waste to the day it was made; Plan Group sets its section in the production email; 'Available for Staff Food' decides whether staff can pick it; Current Unit Cost values waste, damage and staff food.",
        use: EDIT_ROWS,
        affects: ["Production plan and email", "Waste rate", "Staff Food form", "Product Prices"],
    },
    "tables.stock_item": {
        title: "Stock Item",
        what: "The Weekly Stocktake list - exactly the items staff count.",
        how: "Par levels, prices, invoice matching and ordering all read this one list. 'Available for Food Waste' controls which of these items appear in the Food Waste form. The weighed-only 'Food Waste (per 100g)' items are kept separately and aren't shown here.",
        use: EDIT_ROWS,
        affects: ["Weekly Stocktake", "Food Waste form", "Purchasing", "Invoice matching"],
    },
    "tables.stock_item_par": {
        title: "Stock Item Par",
        what: "How much of each item a kiosk should hold, used to decide when to order.",
        how: "When stock is at or below the Minimum (or the Target if there is no Minimum) an order is drafted up to Target + Safety stock. An item with no par row for a kiosk is listed as needing set-up.",
        use: EDIT_ROWS,
        affects: ["Purchasing recommendations"],
    },
    "tables.supplier": {
        title: "Supplier",
        what: "The companies you buy from and how each order reaches you.",
        how: "'Order output method' decides the draft you get after a stocktake: an Excel order sheet, an email listing what to order, or Manual (never ordered automatically). Drafts are emailed to you, never to the supplier.",
        use: EDIT_ROWS,
        affects: ["Purchasing recommendations", "Invoice matching"],
    },
    "tables.supplier_item_map": {
        title: "Supplier Items",
        what: "Links a stock item to the supplier who sells it, with the supplier's own code and case size.",
        how: "Case Multiple is items per case (orders are rounded up to whole cases) and Order Multiple rounds the number of cases up again. An item must have exactly one active supplier: with none or with two it is left out of automatic orders. The codes also help the AI match invoice lines.",
        use: EDIT_ROWS,
        affects: ["Purchasing recommendations", "Invoice matching (Unmapped Lines)"],
    },
    "tables.production_par": {
        title: "Production Par",
        what: "How many of each product a kiosk should have on display after production, for each weekday.",
        how: "Each morning: units to make = today's weekday target - the fridge count staff submit (never below 0). A product with a target of 0 that day isn't planned. Products with no row for the kiosk don't appear on its Fridge Count.",
        use: EDIT_ROWS,
        affects: ["Fridge Count form", "Production plan and email", "Reports: Production"],
    },
    "tables.defrost_item": {
        title: "Defrost Item",
        what: "What appears under 'Defrost tomorrow' in the production email.",
        how: "Most items are worked out automatically from tomorrow's Production Par and the product recipes, according to their Planning Mode. Manual items use the Defrost Par table.",
        use: EDIT_ROWS,
        affects: ["Production email", "Defrost Par"],
    },
    "tables.defrost_par": {
        title: "Defrost Par",
        what: "Manual defrost quantities per kiosk, item and weekday.",
        how: "Only used for items with no automatic calculation. While this is empty those items never appear in the email.",
        use: EDIT_ROWS,
        affects: ["Production email"],
    },
    "tables.component": {
        title: "Component",
        what: "The prep building blocks behind the products: maki, rolls, rice batches, karaage bags.",
        how: "Units per Prep Unit is how many pieces one roll, maki or bag makes; Component Type tells the plan how to turn it into grams of rice. Changing these changes the rice the kiosks are told to cook.",
        use: EDIT_ROWS,
        affects: ["Rice & Batching settings", "Recipe Component", "Production email"],
    },
    "tables.recipe_component": {
        title: "Recipe Component",
        what: "What each product is made of: which components, and how many.",
        how: "The daily plan multiplies these quantities by the units to make to work out prep and rice.",
        use: EDIT_ROWS,
        affects: ["Production plan and email"],
    },
    "tables.audit_question": {
        title: "Audit Question",
        what: "The fixed question list used in every Monthly Audit.",
        how: "Pass Answer is the answer that counts as a pass; Weight is how much it counts towards the score; Critical questions get the shorter correction deadline; Evidence Required means staff must attach a photo; NA Allowed lets staff answer N/A, which is left out of the score.",
        use: EDIT_ROWS,
        affects: ["Monthly Audit form", "Audit score", "Settings: Monthly Audit"],
    },
    "tables.user": {
        title: "Staff",
        what: "Everyone allowed to sign in, and their role.",
        how: "Turn Active off for people who have left: they can no longer sign in, their history is kept. Delete only works for someone with no history. Active Admins receive the supplier order drafts.",
        use: EDIT_ROWS,
        affects: ["Sign-in", "Supplier order emails"],
    },
    "tables.enum_option": {
        title: "Enum Option",
        what: "The choices in the dropdowns and category lists across the system.",
        how: "Deactivating a value hides it from new entries but keeps it on old records.",
        use: EDIT_ROWS,
    },

    // Data Tables column headings
    "col.product.production_role": {
        title: "Production Role",
        what: "How the daily production plan treats the product.",
        how: "Primary and Seasonal Primary products decide how much sushi rice is cooked. Secondary and Seasonal Secondary products are only made from the rice left over. Other roles (Occasional, Historical, Retail, Retired) don't drive rice cooking.",
        affects: ["Production plan and email", "Settings: Secondary Item Allocation"],
    },
    "col.product.shelf_life_days": {
        title: "Shelf Life (days)",
        what: "How many days after it is made the product is thrown away if unsold.",
        how: "Waste is matched to the batch made this many days earlier, so waste rates compare with the right day's plan. Blank uses the default in Settings > Waste Attribution Days (Default). Retail products with no shelf life set aren't matched to a batch.",
        affects: ["Waste rate", "Settings: Waste Attribution Days (Default)"],
    },
    "col.product.plan_group": {
        title: "Plan Group",
        what: "The heading the product is listed under in the production email.",
        how: "Products with the same group are listed together; products with none go under 'Other'.",
        affects: ["Production email"],
    },
    "col.product.staff_food_eligible": {
        title: "Available for Staff Food",
        what: "Whether staff can pick this product in the Staff Food form.",
        how: "Only active products with this on, for the kiosk's brand, appear in the list.",
        affects: ["Staff Food form", "Staff Food dashboard"],
    },
    "col.product.current_unit_cost": {
        title: "Current Unit Cost",
        what: "What one unit costs you.",
        how: "Waste, damage and staff food are valued at this. You can also set it on the Product Prices page.",
        affects: ["KPI Dashboard", "Kiosk Comparison", "Profit", "Staff Food"],
    },
    "col.stock_item.food_waste_eligible": {
        title: "Available for Food Waste",
        what: "Whether staff can choose this item in the Food Waste form.",
        how: "The Food Waste list is the Weekly Stocktake list; only items switched on here appear. Turning it off does not remove the item from the stocktake.",
        use: "Turn off items that are never thrown away as food waste (for example cleaning products).",
        affects: ["Food Waste form", "Weekly Stocktake (unchanged)"],
    },
    "col.stock_item.cost_per_100g": {
        title: "Cost per 100g",
        what: "What 100 g of the item costs.",
        how: "Used to price Food Waste, which is logged in grams: cost = grams / 100 x this. With no value the waste is recorded but shown as not costed.",
        affects: ["Food Waste cost on Kiosk Comparison"],
    },
    "col.stock_item.current_unit_cost": {
        title: "Current Unit Cost",
        what: "What one counting unit of the item costs (a box, a bag, a bottle).",
        how: "Used to value deliveries, transfers and stocktake adjustments. Also editable on the Product Prices page.",
        affects: ["Stock movements", "Product Prices"],
    },
    "col.stock_item_par.target_par": {
        title: "Target Par",
        what: "The stock level to bring the item back up to when ordering.",
        how: "An order tops the item up to Target + Safety stock. If there is no Minimum, the item is ordered as soon as stock reaches the Target.",
        affects: ["Purchasing recommendations"],
    },
    "col.stock_item_par.minimum_stock": {
        title: "Minimum Stock",
        what: "The level at which an order is triggered.",
        how: "When stock is at or below this, the item is ordered. Blank means the Target Par is used.",
        affects: ["Purchasing recommendations"],
    },
    "col.stock_item_par.safety_stock": {
        title: "Safety Stock",
        what: "A cushion added on top of the Target when ordering.",
        how: "Order-up-to level = Target Par + Safety Stock. Blank counts as 0.",
        affects: ["Purchasing recommendations"],
    },
    "col.supplier.order_output_method": {
        title: "Order Output Method",
        what: "How the order drafted for this supplier reaches you.",
        how: "Order sheet: an Excel sheet is emailed to you. Email message: a list of what to order is emailed to you. Manual: never ordered automatically. Nothing is ever sent to the supplier for you.",
        affects: ["Purchasing recommendations", "Site Configuration: SMTP Connection"],
    },
    "col.supplier_item_map.case_multiple": {
        title: "Case Multiple",
        what: "How many of the item come in one case from this supplier.",
        how: "Orders are rounded up to whole cases of this size.",
        affects: ["Purchasing recommendations"],
    },
    "col.supplier_item_map.order_multiple": {
        title: "Order Multiple",
        what: "The supplier's minimum step for ordering cases.",
        how: "The number of cases is rounded up to a multiple of this (1 means no extra rounding).",
        affects: ["Purchasing recommendations"],
    },
    "col.kiosk.token": {
        title: "Token",
        what: "The secret in a kiosk's link that lets its tablet open the staff forms.",
        how: "Anyone with the link can submit forms for that kiosk, so keep it private. Changing the token stops the old link working immediately.",
        note: "Only change it if the link has been shared by mistake.",
    },
    "col.audit_question.pass_answer": {
        title: "Pass Answer",
        what: "The answer that counts as a pass for this question.",
        how: "If you accept a staff answer, it passes only when it matches this (not case sensitive).",
        affects: ["Audit score"],
    },
    "col.audit_question.weight": {
        title: "Weight",
        what: "How much this question counts towards the audit score.",
        how: "Score = the weight of passed questions divided by the weight of all scored questions. A blank weight counts as 1.",
        affects: ["Audit score"],
    },
    "col.audit_question.critical": {
        title: "Critical",
        what: "Marks a question that matters most.",
        how: "A failed critical question gets the shorter correction deadline (Settings > Audit Critical Correction Deadline) and is marked CRITICAL in the review.",
        affects: ["Settings: Monthly Audit"],
    },
    "col.audit_question.evidence_required": {
        title: "Evidence Required",
        what: "Whether staff must attach a photo to answer.",
        how: "If on, the audit can't be submitted for this question without a photo (unless the answer is N/A).",
        affects: ["Monthly Audit form"],
    },
    "col.component.units_per_prep_unit": {
        title: "Units per Prep Unit",
        what: "How many pieces (or portions) one prep unit makes.",
        how: "The plan divides the pieces needed by this to get rolls, maki or bags to prepare - for example pieces per roll or per bag. Wrong here means wrong rice and prep quantities.",
        affects: ["Rice batches", "Production email"],
    },
    "col.recipe_component.qty": {
        title: "Qty",
        what: "How much of the component goes into one unit of the product.",
        how: "Multiplied by the units to make to give the prep quantity.",
        affects: ["Production plan and email"],
    },
};

/** The entry for a help id, or null if there is none. */
export function getHelp(id) {
    return HELP[id] || null;
}

/** Whether a Data Tables column has its own help entry. */
export function columnHelpId(table, column) {
    const id = "col." + table + "." + column;
    return HELP[id] ? id : null;
}

/** The entry to show beside a Data Tables page title: the table's own, else the general one. */
export function tableHelpId(table) {
    const id = "tables." + table;
    return HELP[id] ? id : "tables.page";
}
