const DATA_PATH = "./finance-data.json"
const LOCAL_KEY = "finance-manager-local"

const state = {
  data: null,
  view: "expenses",
  granularity: "day"
}

const tabs = Array.from(document.querySelectorAll(".tab"))
const granularitySelect = document.getElementById("granularity")
const dayField = document.getElementById("dayField")
const monthField = document.getElementById("monthField")
const yearField = document.getElementById("yearField")
const dayInput = document.getElementById("dayInput")
const monthInput = document.getElementById("monthInput")
const yearInput = document.getElementById("yearInput")
const totalValue = document.getElementById("totalValue")
const countValue = document.getElementById("countValue")
const avgValue = document.getElementById("avgValue")
const tableTitle = document.getElementById("tableTitle")
const tableHead = document.getElementById("tableHead")
const tableBody = document.getElementById("tableBody")
const subscriptionsList = document.getElementById("subscriptionsList")
const ppfBox = document.getElementById("ppfBox")
const entryForm = document.getElementById("entryForm")
const entryType = document.getElementById("entryType")
const entryDate = document.getElementById("entryDate")
const entryLabel = document.getElementById("entryLabel")
const entryAmount = document.getElementById("entryAmount")
const entryNote = document.getElementById("entryNote")
const saveLocalBtn = document.getElementById("saveLocalBtn")
const resetBtn = document.getElementById("resetBtn")

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function toDateParts(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number)
  return { y, m, d }
}

function getWeekKey(dateStr) {
  const { y, m, d } = toDateParts(dateStr)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`
}

function formatCurrency(amount, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(amount || 0)
}

async function loadData() {
  const local = localStorage.getItem(LOCAL_KEY)
  if (local) {
    state.data = JSON.parse(local)
    return
  }

  const res = await fetch(DATA_PATH)
  state.data = await res.json()
}

function persistLocal() {
  state.data.meta.lastUpdated = todayISO()
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state.data))
}

function getPeriodMatchFn() {
  const granularity = state.granularity

  if (granularity === "day") {
    const selected = dayInput.value
    return (row) => row.date === selected
  }

  if (granularity === "week") {
    const selected = dayInput.value
    const key = getWeekKey(selected)
    return (row) => getWeekKey(row.date) === key
  }

  if (granularity === "month") {
    const selected = monthInput.value
    return (row) => row.date.slice(0, 7) === selected
  }

  const selectedYear = Number(yearInput.value)
  return (row) => Number(row.date.slice(0, 4)) === selectedYear
}

function getRows() {
  const source = state.view === "expenses" ? state.data.expenses : state.data.income
  return source.filter(getPeriodMatchFn()).sort((a, b) => b.date.localeCompare(a.date))
}

function renderPeriodInputs() {
  dayField.classList.add("hidden")
  monthField.classList.add("hidden")
  yearField.classList.add("hidden")

  if (state.granularity === "day" || state.granularity === "week") {
    dayField.classList.remove("hidden")
  } else if (state.granularity === "month") {
    monthField.classList.remove("hidden")
  } else {
    yearField.classList.remove("hidden")
  }
}

function renderStats(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const count = rows.length
  const avg = count ? total / count : 0
  const currency = state.data.meta.defaultCurrency || "INR"

  totalValue.textContent = formatCurrency(total, currency)
  countValue.textContent = String(count)
  avgValue.textContent = formatCurrency(avg, currency)
}

function renderTable(rows) {
  const isExpense = state.view === "expenses"
  tableTitle.textContent = isExpense ? "Expenses" : "Income"

  tableHead.innerHTML = isExpense
    ? "<tr><th>Date</th><th>Category</th><th>Amount</th><th>Method</th><th>Note</th></tr>"
    : "<tr><th>Date</th><th>Source</th><th>Amount</th><th>Note</th></tr>"

  tableBody.innerHTML = ""
  if (!rows.length) {
    const col = isExpense ? 5 : 4
    tableBody.innerHTML = `<tr><td colspan="${col}">No records in this period</td></tr>`
    return
  }

  for (const row of rows) {
    const tr = document.createElement("tr")
    tr.innerHTML = isExpense
      ? `<td>${row.date}</td><td>${row.category}</td><td>${formatCurrency(row.amount, row.currency)}</td><td>${row.paymentMethod || "-"}</td><td>${row.note || ""}</td>`
      : `<td>${row.date}</td><td>${row.source}</td><td>${formatCurrency(row.amount, row.currency)}</td><td>${row.note || ""}</td>`
    tableBody.appendChild(tr)
  }
}

function renderSubscriptions() {
  const subs = state.data.subscriptions || []
  subscriptionsList.innerHTML = ""

  for (const sub of subs) {
    const div = document.createElement("div")
    div.className = "sub-item"
    const status = sub.active ? "Active" : "Inactive"
    div.innerHTML = `<span>${sub.name} (${sub.frequency})</span><strong>${formatCurrency(sub.amount, sub.currency)} - ${status}</strong>`
    subscriptionsList.appendChild(div)
  }
}

function getSelectedYear() {
  if (state.granularity === "year") {
    return Number(yearInput.value)
  }
  if (state.granularity === "month") {
    return Number(monthInput.value.slice(0, 4))
  }
  if (dayInput.value) {
    return Number(dayInput.value.slice(0, 4))
  }
  return new Date().getFullYear()
}

function renderPPF() {
  const ppf = state.data.investments?.ppf
  if (!ppf) {
    ppfBox.textContent = "No PPF data"
    return
  }

  const year = getSelectedYear()
  const yearly = (ppf.yearlyContributions || []).filter((c) => Number(c.year) === year)
  const paid = yearly.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const target = Number(ppf.annualDepositTarget || 0)
  const rate = Number(ppf.interestRatePercent || 0)
  const done = paid >= target
  const interest = paid * (rate / 100)
  const progress = target ? Math.min(100, (paid / target) * 100) : 0

  ppfBox.innerHTML = `
    <div><strong>PPF Year:</strong> ${year}</div>
    <div><strong>Paid:</strong> ${formatCurrency(paid)}</div>
    <div><strong>Target:</strong> ${formatCurrency(target)}</div>
    <div><strong>Status:</strong> ${done ? "Done" : "Pending"}</div>
    <div><strong>Estimated Interest:</strong> ${formatCurrency(interest)}</div>
    <div><strong>Interest Rate:</strong> ${rate}%</div>
    <div><strong>Progress:</strong> ${progress.toFixed(1)}%</div>
  `
}

function render() {
  const rows = getRows()
  renderPeriodInputs()
  renderStats(rows)
  renderTable(rows)
  renderSubscriptions()
  renderPPF()
}

function nextId(prefix, date) {
  const compact = date.replaceAll("-", "")
  const bucket = prefix === "exp" ? state.data.expenses : state.data.income
  const sameDay = bucket.filter((item) => item.date === date).length + 1
  return `${prefix}-${compact}-${String(sameDay).padStart(3, "0")}`
}

function addEntry(event) {
  event.preventDefault()

  const type = entryType.value
  const date = entryDate.value
  const label = entryLabel.value.trim()
  const amount = Number(entryAmount.value)
  const note = entryNote.value.trim()
  const currency = state.data.meta.defaultCurrency || "INR"

  if (!date || !label || Number.isNaN(amount)) {
    return
  }

  if (type === "expense") {
    state.data.expenses.push({
      id: nextId("exp", date),
      date,
      category: label,
      amount,
      currency,
      note,
      paymentMethod: "Manual"
    })
  } else {
    state.data.income.push({
      id: nextId("inc", date),
      date,
      source: label,
      amount,
      currency,
      note
    })
  }

  persistLocal()
  render()
  entryForm.reset()
  entryDate.value = todayISO()
}

function resetData() {
  localStorage.removeItem(LOCAL_KEY)
  window.location.reload()
}

function setupDefaults() {
  const now = new Date()
  const day = todayISO()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  dayInput.value = day
  monthInput.value = month
  yearInput.value = String(now.getFullYear())
  entryDate.value = day
}

function wireEvents() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"))
      tab.classList.add("active")
      state.view = tab.dataset.view
      render()
    })
  })

  granularitySelect.addEventListener("change", () => {
    state.granularity = granularitySelect.value
    render()
  })

  dayInput.addEventListener("change", render)
  monthInput.addEventListener("change", render)
  yearInput.addEventListener("change", render)

  entryForm.addEventListener("submit", addEntry)
  saveLocalBtn.addEventListener("click", persistLocal)
  resetBtn.addEventListener("click", resetData)
}

async function init() {
  setupDefaults()
  await loadData()
  wireEvents()
  render()
}

init().catch((error) => {
  tableBody.innerHTML = `<tr><td colspan="5">Failed to load data: ${error.message}</td></tr>`
})
