
fetch('/api/test-email', {
  method: 'POST',
  headers: {
    'x-test-secret': 're_ALtni1Vi_BrZaphA88pBJumW6BfVyYZ1n'
  }
})
.then(async response => {
  const result = await response.json();
  console.log(result);
})
.catch(error => console.error(error));
