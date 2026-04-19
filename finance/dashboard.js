const DATA_PATH = "./finance-data.json"
const LOCAL_KEY = "finance-manager-local"

const state = {
  data: null,
  view: "expenses",
  sectionView: "expenses",
  addView: "expense",
  granularity: "day",
  editingSubscriptionIndex: null
}

const tabs = Array.from(document.querySelectorAll("[data-view]"))
const sectionTabs = Array.from(document.querySelectorAll("[data-section-view]"))
const addTabs = Array.from(document.querySelectorAll("[data-add-view]"))
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
const expensesPanel = document.getElementById("expensesPanel")
const subscriptionsPanel = document.getElementById("subscriptionsPanel")
const expenseSummary = document.getElementById("expenseSummary")
const subscriptionsList = document.getElementById("subscriptionsList")
const ppfBox = document.getElementById("ppfBox")
const expenseForm = document.getElementById("expenseForm")
const incomeForm = document.getElementById("incomeForm")
const subscriptionForm = document.getElementById("subscriptionForm")
const expenseDate = document.getElementById("expenseDate")
const expenseCategory = document.getElementById("expenseCategory")
const expenseAmount = document.getElementById("expenseAmount")
const expensePaymentMethod = document.getElementById("expensePaymentMethod")
const expenseNote = document.getElementById("expenseNote")
const incomeDate = document.getElementById("incomeDate")
const incomeSource = document.getElementById("incomeSource")
const incomeAmount = document.getElementById("incomeAmount")
const incomeNote = document.getElementById("incomeNote")
const settingsForm = document.getElementById("settingsForm")
const defaultCurrencyInput = document.getElementById("defaultCurrency")
const configExpenseCategories = document.getElementById("configExpenseCategories")
const configIncomeSources = document.getElementById("configIncomeSources")
const configPaymentMethods = document.getElementById("configPaymentMethods")
const expenseCategoryOptions = document.getElementById("expenseCategoryOptions")
const incomeSourceOptions = document.getElementById("incomeSourceOptions")
const paymentMethodOptions = document.getElementById("paymentMethodOptions")
const subscriptionSubmitBtn = document.getElementById("subscriptionSubmitBtn")
const subscriptionCancelBtn = document.getElementById("subscriptionCancelBtn")
const subName = document.getElementById("subName")
const subAmount = document.getElementById("subAmount")
const subFrequency = document.getElementById("subFrequency")
const subStartDate = document.getElementById("subStartDate")
const subRenewal = document.getElementById("subRenewal")
const subNote = document.getElementById("subNote")
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

function toList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function listToText(list) {
  return (list || []).join(", ")
}

function ensureConfig() {
  state.data.meta = state.data.meta || {}
  state.data.meta.config = state.data.meta.config || {
    expenseCategories: ["Food", "Transport", "Utilities"],
    incomeSources: ["Salary", "Freelance"],
    paymentMethods: ["UPI", "Card", "Cash"]
  }
}

function renderDataList(node, values) {
  node.innerHTML = ""
  values.forEach((value) => {
    const option = document.createElement("option")
    option.value = value
    node.appendChild(option)
  })
}

async function loadData() {
  const local = localStorage.getItem(LOCAL_KEY)
  if (local) {
    state.data = JSON.parse(local)
  } else {
    const res = await fetch(DATA_PATH)
    state.data = await res.json()
  }
  ensureConfig()
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

  subs.forEach((sub, index) => {
    const div = document.createElement("div")
    div.className = "sub-item"
    const status = sub.active ? "Active" : "Inactive"
    const renewal = sub.renewalMonthDay ? `Renews ${sub.renewalMonthDay}` : ""
    div.innerHTML = `
      <span>${sub.name} (${sub.frequency})<br /><small>${renewal}</small></span>
      <div class="sub-item-actions">
        <strong>${formatCurrency(sub.amount, sub.currency)} - ${status}</strong>
        <button type="button" data-sub-edit="${index}">Edit</button>
        <button type="button" data-sub-delete="${index}" class="danger">Delete</button>
      </div>
    `
    subscriptionsList.appendChild(div)
  })
}

function renderExpenseSummary(rows) {
  const categories = new Map()

  for (const row of rows) {
    categories.set(row.category, (categories.get(row.category) || 0) + Number(row.amount || 0))
  }

  expenseSummary.innerHTML = ""
  if (!rows.length) {
    expenseSummary.innerHTML = '<div class="muted-box">No expenses for this period</div>'
    return
  }

  const topCategories = Array.from(categories.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  for (const [category, amount] of topCategories) {
    const item = document.createElement("div")
    item.className = "sub-item"
    item.innerHTML = `<span>${category}</span><strong>${formatCurrency(amount, state.data.meta.defaultCurrency || "INR")}</strong>`
    expenseSummary.appendChild(item)
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

function renderAddView() {
  addTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.addView === state.addView)
  })

  expenseForm.classList.toggle("hidden", state.addView !== "expense")
  incomeForm.classList.toggle("hidden", state.addView !== "income")
  subscriptionForm.classList.toggle("hidden", state.addView !== "subscription")
}

function renderSettings() {
  const cfg = state.data.meta.config
  defaultCurrencyInput.value = state.data.meta.defaultCurrency || "INR"
  configExpenseCategories.value = listToText(cfg.expenseCategories)
  configIncomeSources.value = listToText(cfg.incomeSources)
  configPaymentMethods.value = listToText(cfg.paymentMethods)
  renderDataList(expenseCategoryOptions, cfg.expenseCategories)
  renderDataList(incomeSourceOptions, cfg.incomeSources)
  renderDataList(paymentMethodOptions, cfg.paymentMethods)
}

function render() {
  const rows = getRows()
  const expenseRows = state.data.expenses.filter(getPeriodMatchFn()).sort((a, b) => b.date.localeCompare(a.date))
  renderPeriodInputs()
  renderStats(rows)
  renderTable(rows)
  renderExpenseSummary(expenseRows)
  renderSubscriptions()
  renderPPF()
  renderSectionView()
  renderAddView()
  renderSettings()
}

function renderSectionView() {
  sectionTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.sectionView === state.sectionView)
  })

  expensesPanel.classList.toggle("hidden", state.sectionView !== "expenses")
  subscriptionsPanel.classList.toggle("hidden", state.sectionView !== "subscriptions")
}

function resetSubscriptionForm() {
  state.editingSubscriptionIndex = null
  subscriptionForm.reset()
  subStartDate.value = todayISO()
  subscriptionSubmitBtn.textContent = "Add Subscription"
  subscriptionCancelBtn.classList.add("hidden")
}

function nextId(prefix, date) {
  const compact = date.replaceAll("-", "")
  const bucket = prefix === "exp" ? state.data.expenses : state.data.income
  const sameDay = bucket.filter((item) => item.date === date).length + 1
  return `${prefix}-${compact}-${String(sameDay).padStart(3, "0")}`
}

function addExpense(event) {
  event.preventDefault()
  const date = expenseDate.value
  const category = expenseCategory.value.trim()
  const amount = Number(expenseAmount.value)
  const paymentMethod = expensePaymentMethod.value.trim() || "Manual"
  const note = expenseNote.value.trim()
  const currency = state.data.meta.defaultCurrency || "INR"

  if (!date || !category || Number.isNaN(amount)) {
    return
  }

  state.data.expenses.push({
    id: nextId("exp", date),
    date,
    category,
    amount,
    currency,
    note,
    paymentMethod
  })

  persistLocal()
  render()
  expenseForm.reset()
  expenseDate.value = todayISO()
}

function addIncome(event) {
  event.preventDefault()
  const date = incomeDate.value
  const source = incomeSource.value.trim()
  const amount = Number(incomeAmount.value)
  const note = incomeNote.value.trim()
  const currency = state.data.meta.defaultCurrency || "INR"

  if (!date || !source || Number.isNaN(amount)) {
    return
  }

  state.data.income.push({
    id: nextId("inc", date),
    date,
    source,
    amount,
    currency,
    note
  })

  persistLocal()
  render()
  incomeForm.reset()
  incomeDate.value = todayISO()
}

function addSubscription(event) {
  event.preventDefault()

  const name = subName.value.trim()
  const amount = Number(subAmount.value)
  const frequency = subFrequency.value
  const startDate = subStartDate.value
  const renewalMonthDay = subRenewal.value.trim() || startDate.slice(5)
  const note = subNote.value.trim()
  const currency = state.data.meta.defaultCurrency || "INR"

  if (!name || Number.isNaN(amount) || !startDate) {
    return
  }

  const subscriptions = state.data.subscriptions || (state.data.subscriptions = [])

  if (state.editingSubscriptionIndex === null) {
    const nextId = `sub-${String(subscriptions.length + 1).padStart(3, "0")}`
    subscriptions.push({
      id: nextId,
      name,
      amount,
      currency,
      frequency,
      startDate,
      renewalMonthDay,
      active: true,
      note
    })
  } else {
    const existing = subscriptions[state.editingSubscriptionIndex]
    subscriptions[state.editingSubscriptionIndex] = {
      ...existing,
      name,
      amount,
      currency,
      frequency,
      startDate,
      renewalMonthDay,
      note
    }
  }

  persistLocal()
  render()
  resetSubscriptionForm()
}

function saveSettings(event) {
  event.preventDefault()
  state.data.meta.defaultCurrency = defaultCurrencyInput.value.trim().toUpperCase() || "INR"
  state.data.meta.config.expenseCategories = toList(configExpenseCategories.value)
  state.data.meta.config.incomeSources = toList(configIncomeSources.value)
  state.data.meta.config.paymentMethods = toList(configPaymentMethods.value)
  persistLocal()
  render()
}

function startSubscriptionEdit(index) {
  const sub = state.data.subscriptions?.[index]
  if (!sub) {
    return
  }

  state.editingSubscriptionIndex = index
  state.addView = "subscription"
  subName.value = sub.name || ""
  subAmount.value = String(sub.amount ?? "")
  subFrequency.value = sub.frequency || "monthly"
  subStartDate.value = sub.startDate || todayISO()
  subRenewal.value = sub.renewalMonthDay || ""
  subNote.value = sub.note || ""
  subscriptionSubmitBtn.textContent = "Update Subscription"
  subscriptionCancelBtn.classList.remove("hidden")
  renderAddView()
}

function deleteSubscription(index) {
  const sub = state.data.subscriptions?.[index]
  if (!sub) {
    return
  }

  if (!window.confirm(`Delete subscription "${sub.name}"?`)) {
    return
  }

  state.data.subscriptions.splice(index, 1)
  persistLocal()
  render()

  if (state.editingSubscriptionIndex === index) {
    resetSubscriptionForm()
  }
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
  expenseDate.value = day
  incomeDate.value = day
  subStartDate.value = day
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

  sectionTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.sectionView = tab.dataset.sectionView
      render()
    })
  })

  addTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.addView = tab.dataset.addView
      renderAddView()
    })
  })

  granularitySelect.addEventListener("change", () => {
    state.granularity = granularitySelect.value
    render()
  })

  dayInput.addEventListener("change", render)
  monthInput.addEventListener("change", render)
  yearInput.addEventListener("change", render)

  expenseForm.addEventListener("submit", addExpense)
  incomeForm.addEventListener("submit", addIncome)
  subscriptionForm.addEventListener("submit", addSubscription)
  settingsForm.addEventListener("submit", saveSettings)
  subscriptionCancelBtn.addEventListener("click", resetSubscriptionForm)
  subscriptionsList.addEventListener("click", (event) => {
    const editTarget = event.target.closest("[data-sub-edit]")
    const deleteTarget = event.target.closest("[data-sub-delete]")

    if (editTarget) {
      startSubscriptionEdit(Number(editTarget.dataset.subEdit))
    }

    if (deleteTarget) {
      deleteSubscription(Number(deleteTarget.dataset.subDelete))
    }
  })
  saveLocalBtn.addEventListener("click", persistLocal)
  resetBtn.addEventListener("click", resetData)
}

async function init() {
  setupDefaults()
  await loadData()
  wireEvents()
  render()
  resetSubscriptionForm()
}

init().catch((error) => {
  tableBody.innerHTML = `<tr><td colspan="5">Failed to load data: ${error.message}</td></tr>`
})
