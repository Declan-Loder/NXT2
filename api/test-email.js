
fetch('/api/test-email', {
  method: 'POST',
  headers: {
    'x-test-secret': 'YOUR_TEST_SECRET'
  }
})
.then(async response => {
  const result = await response.json();
  console.log(result);
})
.catch(error => console.error(error));
