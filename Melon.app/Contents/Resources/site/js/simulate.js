const TOO_LARGE = 'This grows too large to calculate. Try a lower rate or a shorter term.'

function overflowed(value) {
  return !Number.isFinite(value) || Math.abs(value) > 1e15
}

export function projectCompound({
  principal,
  annualRatePercent,
  years,
  compoundsPerYear,
  contribution,
  contributionFrequency,
}) {
  const n = compoundsPerYear
  if (!(n > 0) || years < 0 || principal < 0) {
    return { ok: false, error: 'Enter a valid term and rate.' }
  }

  const periods = Math.round(years * n)
  const rate = annualRatePercent / 100 / n
  if (periods > 200000) {
    return { ok: false, error: 'That term is too long to calculate.' }
  }

  let balance = principal
  let contributed = principal
  const balances = [principal]
  const contributedSeries = [principal]
  const times = [0]
  const rows = []

  if (periods === 0) {
    rows.push({ year: 0, elapsed: 0, deposit: 0, interest: 0, balance: principal })
    return {
      ok: true,
      value: {
        futureValue: principal,
        totalContributed: principal,
        interestEarned: 0,
        rows,
        balances,
        contributedSeries,
        times,
      },
    }
  }

  let yearDeposits = 0
  let yearStart = principal
  let bucket = 1
  const monthlyPeriods = n / 12

  for (let p = 1; p <= periods; p++) {
    balance *= 1 + rate
    let deposit = 0
    if (contributionFrequency === 'yearly') {
      if (p % n === 0) deposit = contribution
    } else if (contributionFrequency === 'monthly' && contribution !== 0) {
      if (Number.isInteger(monthlyPeriods)) {
        if (p % monthlyPeriods === 0) deposit = contribution
      } else {
        deposit = contribution * (12 / n)
      }
    }
    balance += deposit
    contributed += deposit
    yearDeposits += deposit
    if (overflowed(balance)) return { ok: false, error: TOO_LARGE }

    if (p % n === 0 || p === periods) {
      rows.push({
        year: bucket,
        elapsed: p / n,
        deposit: yearDeposits,
        interest: balance - yearStart - yearDeposits,
        balance,
      })
      balances.push(balance)
      contributedSeries.push(contributed)
      times.push(p / n)
      yearDeposits = 0
      yearStart = balance
      if (p !== periods) bucket += 1
    }
  }

  return {
    ok: true,
    value: {
      futureValue: balance,
      totalContributed: contributed,
      interestEarned: balance - contributed,
      rows,
      balances,
      contributedSeries,
      times,
    },
  }
}

export function amortize(principal, annualRatePercent, termMonths, extra) {
  if (!(principal > 0) || !(termMonths > 0)) {
    return { ok: false, error: 'Enter a loan amount and a term of at least 1 day.' }
  }

  // US loans quote a nominal APR. The monthly rate is that APR divided by 12.
  const r = annualRatePercent / 100 / 12
  if (termMonths < 1) {
    const interest = principal * r * termMonths
    const payment = principal + interest
    if (!Number.isFinite(payment)) return { ok: false, error: 'Could not calculate a payment for these inputs.' }
    return {
      ok: true,
      value: {
        scheduled: payment,
        payoffMonths: termMonths,
        totalInterest: interest,
        totalPaid: payment,
        yearly: [{ year: 1, payment, principal, interest, balance: 0 }],
        balances: [principal, 0],
      },
    }
  }

  const growth = Math.pow(1 + r, termMonths)
  const scheduled = r === 0 ? principal / termMonths : (principal * r * growth) / (growth - 1)
  if (!Number.isFinite(scheduled) || scheduled < 0) {
    return { ok: false, error: 'Could not calculate a payment for these inputs.' }
  }

  const last = Math.ceil(termMonths - 1e-9)
  let balance = principal
  let totalInterest = 0
  let totalPaid = 0
  const balances = [principal]
  const yearly = []
  let yPay = 0
  let yPrin = 0
  let yInt = 0
  let bucketYear = 1
  let payoffMonths = 0

  for (let m = 1; balance > 0.004 && m <= last + 1200; m++) {
    const slice = m === last ? Math.min(1, termMonths - (last - 1)) : 1
    const interest = balance * r * slice
    let principalPaid
    if (extra === 0 && m === last) {
      principalPaid = balance
    } else {
      principalPaid = scheduled + extra - interest
      if (principalPaid > balance) principalPaid = balance
      if (principalPaid <= 0.000001) {
        return {
          ok: false,
          error: 'The payment does not cover interest. Shorten the term or add an extra payment.',
        }
      }
    }

    const payment = principalPaid + interest
    balance -= principalPaid
    if (balance < 0.005) balance = 0
    totalInterest += interest
    totalPaid += payment
    yPay += payment
    yPrin += principalPaid
    yInt += interest
    payoffMonths = extra === 0 && m === last ? termMonths : m

    if (m % 12 === 0 || balance === 0) {
      yearly.push({ year: bucketYear, payment: yPay, principal: yPrin, interest: yInt, balance })
      balances.push(balance)
      yPay = 0
      yPrin = 0
      yInt = 0
      if (balance > 0) bucketYear += 1
    }
  }

  if (balance > 0.005) {
    return { ok: false, error: 'The loan does not pay off with these inputs.' }
  }

  return {
    ok: true,
    value: { scheduled, payoffMonths, totalInterest, totalPaid, yearly, balances },
  }
}

export function payOffCard(balance, annualRatePercent, payment) {
  if (!(balance > 0) || !(payment > 0)) {
    return { ok: false, error: 'Enter a balance and a payment greater than zero.' }
  }

  const r = annualRatePercent / 100 / 12
  const maxMonths = 600
  let bal = balance
  let totalInterest = 0
  let totalPaid = 0
  const balances = [balance]
  const yearly = []
  let yPay = 0
  let yPrin = 0
  let yInt = 0
  let year = 1
  let payoffMonths = 0

  for (let m = 1; m <= maxMonths && bal > 0.004; m++) {
    const interest = bal * r
    let principalPaid = payment - interest
    if (principalPaid <= 0.004) {
      return { ok: false, error: 'This payment does not cover monthly interest, so the balance keeps growing.' }
    }
    if (principalPaid > bal) principalPaid = bal
    const paid = principalPaid + interest
    bal -= principalPaid
    if (bal < 0.005) bal = 0
    if (overflowed(totalInterest + interest)) return { ok: false, error: TOO_LARGE }
    totalInterest += interest
    totalPaid += paid
    yPay += paid
    yPrin += principalPaid
    yInt += interest
    payoffMonths = m
    if (m % 12 === 0 || bal === 0) {
      yearly.push({ year, payment: yPay, principal: yPrin, interest: yInt, balance: bal })
      balances.push(bal)
      yPay = 0
      yPrin = 0
      yInt = 0
      if (bal > 0) year += 1
    }
  }

  if (bal > 0.005) {
    return { ok: false, error: 'This balance takes more than 50 years to pay off. Raise the payment.' }
  }

  return { ok: true, value: { payoffMonths, totalInterest, totalPaid, yearly, balances } }
}

function pickCard(cards, method) {
  const open = cards.filter((card) => card.balance > 0.004 || card.interestDue > 0.004)
  if (!open.length) return null
  if (method === 'snowball') open.sort((a, b) => a.balance - b.balance || b.apr - a.apr || a.index - b.index)
  else open.sort((a, b) => b.apr - a.apr || a.balance - b.balance || a.index - b.index)
  return open[0]
}

function applyCardPayment(card, amount) {
  const owed = card.balance + card.interestDue
  const pay = Math.min(Math.max(0, amount), owed)
  const toInterest = Math.min(pay, card.interestDue)
  card.interestDue -= toInterest
  card.balance -= pay - toInterest
  if (card.balance < 0.005) card.balance = 0
  if (card.interestDue < 0.005) card.interestDue = 0
  return pay
}

export function payOffCards(cards, budget, method, maxMonths = 600) {
  if (!cards.length) return { ok: false, error: 'Add a card.' }
  const state = cards.map((card, index) => ({
    index,
    name: card.name,
    apr: card.apr,
    minimum: card.minimum,
    startingBalance: card.balance,
    balance: card.balance,
    interestDue: 0,
    interest: 0,
    payoffMonths: 0,
  }))
  const useBudget = method !== 'minimums'
  if (useBudget && !(budget > 0)) return { ok: false, error: 'Enter a monthly payment greater than zero.' }

  let totalInterest = 0
  let totalPaid = 0
  let payoffMonths = 0
  const startBalance = state.reduce((sum, card) => sum + card.balance, 0)
  const balances = [startBalance]
  const yearly = []
  let yPay = 0
  let yInt = 0
  let year = 1

  for (let month = 1; month <= maxMonths; month++) {
    if (!state.some((card) => card.balance > 0.004)) break
    for (const card of state) {
      if (card.balance <= 0.004) continue
      card.interestDue = card.balance * card.apr / 100 / 12
      card.interest += card.interestDue
      totalInterest += card.interestDue
      yInt += card.interestDue
      if (overflowed(totalInterest)) return { ok: false, error: TOO_LARGE }
    }

    let spent = 0
    const ordered = state.filter((card) => card.balance > 0.004 || card.interestDue > 0.004)
    if (method === 'snowball') ordered.sort((a, b) => a.balance - b.balance || b.apr - a.apr || a.index - b.index)
    else ordered.sort((a, b) => b.apr - a.apr || a.balance - b.balance || a.index - b.index)
    for (const card of ordered) {
      const room = useBudget ? budget - spent : Infinity
      if (room <= 0.004) break
      const owed = card.balance + card.interestDue
      const pay = applyCardPayment(card, Math.min(card.minimum, owed, room))
      spent += pay
      totalPaid += pay
      yPay += pay
      if (card.balance <= 0.004 && card.interestDue <= 0.004 && !card.payoffMonths) card.payoffMonths = month
    }

    let extra = useBudget ? budget - spent : 0
    while (extra > 0.004) {
      const target = pickCard(state, method)
      if (!target) break
      const pay = applyCardPayment(target, extra)
      if (pay <= 0.004) break
      extra -= pay
      totalPaid += pay
      yPay += pay
      if (target.balance <= 0.004 && target.interestDue <= 0.004 && !target.payoffMonths) target.payoffMonths = month
    }

    for (const card of state) {
      if (card.interestDue > 0.004) {
        card.balance += card.interestDue
        card.interestDue = 0
      }
    }
    payoffMonths = month
    const remaining = state.reduce((sum, card) => sum + card.balance, 0)
    if (month % 12 === 0 || remaining <= 0.004) {
      yearly.push({ year, payment: yPay, interest: yInt, balance: remaining })
      balances.push(remaining)
      yPay = 0
      yInt = 0
      if (remaining > 0.004) year += 1
    }
    if (remaining <= 0.004) break
  }

  const remaining = state.reduce((sum, card) => sum + card.balance, 0)
  const paidOff = remaining <= 0.005
  const ordered = state
    .filter((card) => card.payoffMonths > 0)
    .sort((a, b) => a.payoffMonths - b.payoffMonths || (method === 'snowball' ? a.startingBalance - b.startingBalance : b.apr - a.apr) || a.index - b.index)
  const unpaid = state.filter((card) => !card.payoffMonths).sort((a, b) => a.index - b.index)

  return {
    ok: true,
    value: {
      paidOff,
      payoffMonths: paidOff ? payoffMonths : 0,
      remaining,
      totalInterest,
      totalPaid,
      yearly,
      balances,
      cards: [...ordered, ...unpaid].map((card) => ({
        name: card.name,
        payoffMonths: card.payoffMonths,
        interest: card.interest,
        apr: card.apr,
        startingBalance: card.startingBalance,
      })),
    },
  }
}

export function monthsToGoal(current, goal, monthlyRate, monthlyContribution, maxMonths = 1200) {
  if (current >= goal) return 0
  if (monthlyContribution <= 0 && monthlyRate <= 0) return null
  if (current <= 0 && monthlyContribution <= 0) return null

  let balance = current
  for (let m = 1; m <= maxMonths; m++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution
    if (overflowed(balance)) return null
    if (balance >= goal) return m
  }
  return null
}

export function paymentForTarget(current, goal, monthlyRate, months) {
  if (months <= 0) return null
  const growth = Math.pow(1 + monthlyRate, months)
  if (!Number.isFinite(growth)) return null
  const futureCurrent = current * growth
  if (futureCurrent >= goal) return 0
  if (monthlyRate === 0) return (goal - current) / months
  return (goal - futureCurrent) * (monthlyRate / (growth - 1))
}

export function projectMonthly(current, monthlyRate, monthlyContribution, months) {
  let balance = current
  const balances = [current]
  const rows = []
  if (months <= 0) {
    return { ok: true, value: { futureValue: balance, rows, balances } }
  }

  let yearDeposits = 0
  let yearInterest = 0
  let year = 1
  for (let m = 1; m <= months; m++) {
    const before = balance
    balance = balance * (1 + monthlyRate) + monthlyContribution
    if (overflowed(balance)) return { ok: false, error: TOO_LARGE }
    yearDeposits += monthlyContribution
    yearInterest += balance - before - monthlyContribution
    if (m % 12 === 0 || m === months) {
      rows.push({ year, deposit: yearDeposits, interest: yearInterest, balance })
      balances.push(balance)
      yearDeposits = 0
      yearInterest = 0
      if (m !== months) year += 1
    }
  }

  return { ok: true, value: { futureValue: balance, rows, balances } }
}
