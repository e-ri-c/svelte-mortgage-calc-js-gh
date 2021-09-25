<script>
  var formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  });
  let loanAmount = 200000;
  let years = 15;
  let interestRateInput = 200;
  $: interestRate = interestRateInput / 100;
  $: totalPayments = years * 12;
  $: monthlyInterestRate = interestRate / 100 / 12;
  $: monthlyPayment =
    (loanAmount *
      Math.pow(1 + monthlyInterestRate, totalPayments) *
      monthlyInterestRate) /
    (Math.pow(1 + monthlyInterestRate, totalPayments) - 1);
  $: totalPaid = monthlyPayment * totalPayments;
  $: interestPaid = totalPaid - loanAmount;
</script>

<main class="container">
  <div class="row">
    <h1>Mortgage Calculator JS</h1>
  </div>
  <div class="row">
    <label
      >Loan Amount
      <input
        min="1"
        bind:value={loanAmount}
        placeholder="Enter loan amount"
        type="number"
        class="u-full-width"
      />
    </label>
  </div>
  <div class="row">
    <div class="columns six">
      <label
        >Years
        <input
          type="range"
          min="1"
          max="50"
          class="u-full-width"
          bind:value={years}
        />
      </label>
    </div>
    <div class="columns six outputs">{years} years</div>
  </div>

  <div class="row">
    <div class="columns six">
      <label
        >Interest
        <input
          type="range"
          min="1"
          max="2000"
          class="u-full-width"
          bind:value={interestRateInput}
        />
      </label>
    </div>
    <div class="columns six outputs">{interestRate.toFixed(2)} %</div>
  </div>

  <div class="row outputs">
    Monthly Payments : {formatter.format(monthlyPayment)}
  </div>
  <div class="row outputs">Total Paid : {formatter.format(totalPaid)}</div>
  <div class="row outputs">
    Interest Paid : {formatter.format(interestPaid)}
  </div>
</main>

<style>
  .outputs {
    font-size: 20px;
    border: solid blue 2px;
    margin-top: 15px;
    text-align: center;
  }
</style>
