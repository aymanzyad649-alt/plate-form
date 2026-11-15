const form = $('#login-form');
const errorBox = $('#login-error');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  errorBox.textContent = '';
  setBusy(submitButton, true, 'بيدخل…');

  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: {
        username: form.elements.username.value,
        password: form.elements.password.value,
      },
    });

    // الكاش القديم بتاع أي مستخدم تاني ميبقاش موجود
    Cache.clear();
    Cache.write('me', { user });

    window.location.href = user.role === 'admin' ? '/admin' : '/dashboard';
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(submitButton, false, 'دخول');
    form.elements.password.select();
  }
});
