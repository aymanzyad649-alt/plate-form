let currentUser = null;

function renderHeader(user) {
  $('#avatar').textContent = initials(user.display_name);
  $('#user-name').textContent = user.display_name;
  $('#user-username').textContent = '@' + user.username;
}

/** بنعيد حساب التقدم محليًا بعد أي تعليم/إلغاء، عشان الواجهة تتحدّث فورًا */
function updateProgress(level) {
  const total = level.lessons.length;
  const completed = level.lessons.filter((lesson) => lesson.completed).length;

  level.progress = {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };

  return level.progress;
}

function progressBar(percent) {
  return el('div', { class: 'progress-track' }, [
    el('div', { class: 'progress-fill', style: `width:${percent}%` }),
  ]);
}

function stat(value, label) {
  return el('div', { class: 'stat' }, [
    el('strong', { text: String(value) }),
    el('span', { text: label }),
  ]);
}

function renderHero(level, user) {
  const hero = $('#hero');
  const parts = [];

  if (!level) {
    parts.push(el('h2', { text: `أهلاً ${user.display_name} 👋` }));
    parts.push(
      el('p', {
        text: 'لسه مفيش مستوى متحدد لحسابك. كلّم مسؤول المنصة يحددلك مستواك وتظهر دروسك هنا.',
      })
    );
  } else {
    const progress = level.progress || updateProgress(level);

    parts.push(el('span', { class: 'badge', text: 'مستواك الحالي' }));
    parts.push(el('h2', { text: level.name }));
    if (level.description) parts.push(el('p', { text: level.description }));

    parts.push(
      el('div', { class: 'stat-row' }, [
        stat(progress.total, 'إجمالي الدروس'),
        stat(progress.completed, 'دروس خلّصتها'),
        stat(`${progress.percent}%`, 'نسبة التقدم'),
      ])
    );

    parts.push(progressBar(progress.percent));
  }

  hero.replaceChildren(...parts);
}

function fileIcon(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();

  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return '🎧';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📽️';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['doc', 'docx', 'rtf', 'odt', 'txt', 'md'].includes(ext)) return '📄';
  return '📎';
}

function renderLessonFiles(files) {
  const box = $('#lesson-files');

  if (!files || !files.length) {
    box.replaceChildren();
    box.hidden = true;
    return;
  }

  const title = el('strong', { class: 'files-title', text: `مرفقات الدرس (${files.length})` });
  const list = el('div', { class: 'file-list' });

  for (const file of files) {
    list.append(
      el('a', {
        class: 'file-item',
        href: `/api/files/${file.id}`,
        download: file.original_name,
      }, [
        el('span', { class: 'file-icon', text: fileIcon(file.original_name) }),
        el('span', { class: 'file-text' }, [
          el('strong', { text: file.original_name }),
          el('small', { text: formatFileSize(file.size) }),
        ]),
        el('span', { class: 'file-download', text: 'تحميل ⬇' }),
      ])
    );
  }

  box.replaceChildren(title, list);
  box.hidden = false;
}

function openLesson(lesson) {
  $('#lesson-dialog-title').textContent = lesson.title;
  $('#lesson-dialog-body').textContent =
    lesson.content || 'الدرس ده لسه مفيش فيه محتوى مكتوب.';

  const video = $('#lesson-video');
  const url = /^https?:\/\//i.test(lesson.video_url || '') ? lesson.video_url : '';

  if (url) {
    video.href = url;
    video.hidden = false;
  } else {
    video.removeAttribute('href');
    video.hidden = true;
  }

  renderLessonFiles(lesson.files || []);

  $('#lesson-dialog').showModal();
}

async function toggleLesson(level, lesson, button) {
  const nextCompleted = !lesson.completed;
  button.disabled = true;

  try {
    const result = await api(`/api/lessons/${lesson.id}/progress`, {
      method: 'POST',
      body: { completed: nextCompleted },
    });

    lesson.completed = result.completed;
    level.progress = result.progress;

    // نحدّث الكاش بنفس الشكل اللي الـ API بيرجّعه
    Cache.write('my-level', { level });

    renderHero(level, currentUser);
    renderLessons(level);

    toast(nextCompleted ? 'تم تسجيل الدرس كمكتمل ✅' : 'تم إلغاء إنجاز الدرس');
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

function renderLessons(level) {
  const box = $('#lessons-box');
  const count = $('#lessons-count');

  if (!level || !level.lessons.length) {
    count.textContent = '';
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مفيش دروس هنا لسه' }),
        'أول ما مسؤول المنصة يضيف دروس لمستواك هتظهر هنا.',
      ])
    );
    return;
  }

  const progress = level.progress || updateProgress(level);
  count.textContent = `${progress.completed} من ${progress.total} مكتمل`;

  const list = el('div', { class: 'lesson-list' });

  level.lessons.forEach((lesson, index) => {
    const snippet = lesson.content
      ? `${lesson.content.slice(0, 85)}${lesson.content.length > 85 ? '…' : ''}`
      : 'اضغط لفتح الدرس';

    const item = el('button', { class: 'lesson-item', type: 'button' }, [
      el('span', { class: 'lesson-index', text: String(index + 1) }),
      el('span', { class: 'lesson-text' }, [
        el('strong', { text: lesson.title }),
        el('small', { text: snippet }),
      ]),
      el('span', { class: 'chevron', text: '‹' }),
    ]);

    item.addEventListener('click', () => openLesson(lesson));

    const toggle = el('button', {
      class: `complete-btn${lesson.completed ? ' done' : ''}`,
      type: 'button',
      title: lesson.completed ? 'إلغاء إنجاز الدرس' : 'علّم الدرس كمكتمل',
      'aria-label': lesson.completed ? 'إلغاء إنجاز الدرس' : 'علّم الدرس كمكتمل',
      'aria-pressed': lesson.completed ? 'true' : 'false',
      text: lesson.completed ? '✓' : '○',
    });

    toggle.addEventListener('click', () => toggleLesson(level, lesson, toggle));

    list.append(
      el('div', { class: `lesson-row${lesson.completed ? ' completed' : ''}` }, [item, toggle])
    );
  });

  box.replaceChildren(list);
}

function fillProfileForm(user) {
  const fields = $('#profile-form').elements;
  fields.display_name.value = user.display_name;
  fields.username.value = user.username;
  fields.currentPassword.value = '';
}

function renderGrades(data) {
  const box = $('#grades-box');
  const summaryBadge = $('#grades-summary');
  const summary = data?.summary;
  const assessments = data?.assessments || [];

  if (!assessments.length) {
    summaryBadge.textContent = '';
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مفيش تقييمات لسه' }),
        'أول ما مسؤول المنصة يضيف تقييمات لمستواك هتظهر درجاتك هنا.',
      ])
    );
    return;
  }

  summaryBadge.textContent =
    summary.percent === null ? `${summary.total} تقييم` : `متوسطك ${summary.percent}%`;

  const list = el('div', { class: 'grade-list' });

  for (const assessment of assessments) {
    const hasScore = assessment.score !== null && assessment.score !== undefined;
    const percent = hasScore ? assessment.percent : null;

    const badge = hasScore
      ? el('span', {
          class: `badge ${percent >= 50 ? 'badge-success' : 'badge-danger'}`,
          text: `${percent}%`,
        })
      : el('span', { class: 'badge badge-muted', text: '—' });

    list.append(
      el('div', { class: `grade-row${hasScore ? '' : ' pending'}` }, [
        el('div', { class: 'grade-info' }, [
          el('strong', { text: assessment.title }),
          el('small', {
            text: hasScore
              ? `${assessment.score} من ${assessment.max_score}`
              : `من ${assessment.max_score} — لسه مترصدش`,
          }),
        ]),
        badge,
      ])
    );
  }

  if (summary.graded > 0) {
    list.append(
      el('p', {
        class: 'muted small grade-total',
        text: `مجموعك ${summary.score} من ${summary.max_score} في ${summary.graded} تقييم`,
      })
    );
  }

  box.replaceChildren(list);
}

async function loadDashboard() {
  const [{ user }, levelData, gradesData] = await Promise.all([
    api('/api/me', { cacheKey: 'me' }),
    api('/api/my-level', { cacheKey: 'my-level' }),
    api('/api/my-grades', { cacheKey: 'my-grades' }),
  ]);

  currentUser = user;
  renderHeader(user);
  renderHero(levelData.level, user);
  renderLessons(levelData.level);
  renderGrades(gradesData);
  fillProfileForm(user);
}

function bindProfileForm() {
  const form = $('#profile-form');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const fields = form.elements;
    const errorBox = $('#profile-error');
    const button = form.querySelector('button[type="submit"]');

    errorBox.textContent = '';
    setBusy(button, true, 'بيحفظ…');

    try {
      const { user } = await api('/api/me', {
        method: 'PATCH',
        body: {
          display_name: fields.display_name.value,
          username: fields.username.value,
          currentPassword: fields.currentPassword.value,
        },
      });

      currentUser = user;
      Cache.write('me', { user });
      renderHeader(user);
      fields.currentPassword.value = '';
      toast('تم تحديث بيانات الحساب ✅');
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
}

function bindPasswordForm() {
  const form = $('#password-form');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const fields = form.elements;
    const errorBox = $('#password-error');
    const button = form.querySelector('button[type="submit"]');
    const newPassword = fields.newPassword.value;

    errorBox.textContent = '';

    if (newPassword !== fields.confirmPassword.value) {
      errorBox.textContent = 'تأكيد الباسورد مش مطابق';
      return;
    }

    setBusy(button, true, 'بيغيّر…');

    try {
      await api('/api/me/password', {
        method: 'POST',
        body: {
          currentPassword: fields.currentPassword.value,
          newPassword,
        },
      });

      form.reset();
      toast('تم تغيير الباسورد. الجلسات التانية اتقفلت ✅');
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
}

async function init() {
  wireDialogs();

  // عرض سريع من الكاش قبل ما نستنى الشبكة
  const cached = Cache.read('me');
  if (cached?.user) renderHeader(cached.user);

  bindProfileForm();
  bindPasswordForm();

  $('#logout-btn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* حتى لو الطلب فشل، هنمسح الكاش ونخرج */
    }
    Cache.clear();
    window.location.href = '/';
  });

  await Cache.syncVersion();

  try {
    await loadDashboard();
  } catch (error) {
    if (error.status === 401) return; // api() هتحوّل لصفحة الدخول

    toast(error.message, 'error');
    $('#hero').replaceChildren(
      el('h2', { text: 'مش قادر أحمّل البيانات' }),
      el('p', { text: 'اتأكد من اتصالك بالإنترنت وجرّب تحدّث الصفحة.' })
    );
  }
}

init();
