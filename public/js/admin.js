const state = {
  students: [],
  levels: [],
  filter: '',
  lessonsLevelId: '',
  sheet: null,
};

/* ------------------------------- أدوات مساعدة ------------------------------ */

function levelOptions(selectedId) {
  const options = [el('option', { value: '' }, 'بدون مستوى')];

  for (const level of state.levels) {
    const option = el('option', { value: String(level.id) }, level.name);
    if (Number(selectedId) === level.id) option.selected = true;
    options.push(option);
  }

  return options;
}

function fillLevelSelect(select, selectedId) {
  select.replaceChildren(...levelOptions(selectedId));
}

async function reloadData() {
  Cache.clear();
  await Promise.all([loadStudents(), loadLevels()]);
}

/* --------------------------------- الطلاب --------------------------------- */

async function loadStudents() {
  const box = $('#students-box');

  try {
    const { students } = await api('/api/admin/students', { cacheKey: 'admin-students' });
    state.students = students;
    renderStudents();
  } catch (error) {
    if (error.status === 401) return;
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مش قادر أجيب الطلاب' }),
        error.message,
      ])
    );
    toast(error.message, 'error');
  }
}

function filteredStudents() {
  const term = state.filter.trim().toLowerCase();
  if (!term) return state.students;

  return state.students.filter((student) => {
    return (
      student.display_name.toLowerCase().includes(term) ||
      student.username.toLowerCase().includes(term) ||
      (student.level_name || '').toLowerCase().includes(term)
    );
  });
}

function renderStudents() {
  const box = $('#students-box');
  const students = filteredStudents();

  if (!students.length) {
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', {
          text: state.students.length ? 'مفيش نتائج للبحث' : 'لسه مفيش طلاب',
        }),
        state.students.length
          ? 'جرّب كلمة بحث تانية.'
          : 'ابدأ بإضافة أول طالب من زرار «طالب جديد».',
      ])
    );
    return;
  }

  const body = el('tbody');

  for (const student of students) {
    body.append(
      el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'cell-user' }, [
            el('span', { class: 'avatar', text: initials(student.display_name) }),
            el('div', {}, [
              el('strong', { text: student.display_name }),
              el('code', { text: '@' + student.username }),
            ]),
          ]),
        ]),
        el(
          'td',
          {},
          student.level_name
            ? el('span', { class: 'badge', text: student.level_name })
            : el('span', { class: 'badge badge-muted', text: 'بدون مستوى' })
        ),
        el('td', {}, [
          el('div', {
            class: 'admin-progress',
            title: `نسبة التقدم ${Number(student.progress_percent) || 0}%`,
          }, [
            el('div', { class: 'progress-track' }, [
              el('div', {
                class: 'progress-fill',
                style: `width:${Number(student.progress_percent) || 0}%`,
              }),
            ]),
            el('span', {
              class: 'small muted',
              text: `${Number(student.completed_count) || 0}/${Number(student.lessons_count) || 0}`,
            }),
          ]),
        ]),
        el(
          'td',
          {},
          student.is_active
            ? el('span', { class: 'badge badge-success', text: 'مفعّل' })
            : el('span', { class: 'badge badge-danger', text: 'موقوف' })
        ),
        el('td', { class: 'small muted', text: formatDate(student.created_at) }),
        el('td', {}, [
          el('div', { class: 'row-actions' }, [
            el(
              'button',
              { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openGradesDialog(student) },
              'درجات'
            ),
            el(
              'button',
              { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openStudentDialog(student) },
              'تعديل'
            ),
            el(
              'button',
              { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => toggleStudent(student) },
              student.is_active ? 'إيقاف' : 'تفعيل'
            ),
            el(
              'button',
              { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteStudent(student) },
              'حذف'
            ),
          ]),
        ]),
      ])
    );
  }

  const head = el(
    'thead',
    {},
    el(
      'tr',
      {},
      ['الطالب', 'المستوى', 'التقدم', 'الحالة', 'تاريخ الإضافة', 'إجراءات'].map((title) =>
        el('th', { text: title })
      )
    )
  );

  box.replaceChildren(el('div', { class: 'table-wrap' }, el('table', {}, [head, body])));
}

function openStudentDialog(student = null) {
  const form = $('#student-form');
  const fields = form.elements;

  form.reset();
  fields.record_id.value = student?.id || '';
  fields.display_name.value = student?.display_name || '';
  fields.username.value = student?.username || '';
  fields.password.value = '';
  fields.password.required = !student;
  fields.is_active.checked = student ? Boolean(student.is_active) : true;

  fillLevelSelect(fields.level_id, student?.level_id);

  $('#student-active-wrap').hidden = !student;
  $('#student-dialog-title').textContent = student ? 'تعديل طالب' : 'طالب جديد';
  $('#password-hint').textContent = student
    ? 'سيبها فاضية لو مش عايز تغيّر الباسورد'
    : '6 حروف على الأقل';
  $('#student-error').textContent = '';

  $('#student-dialog').showModal();
}

async function saveStudent(event) {
  event.preventDefault();

  const form = $('#student-form');
  const fields = form.elements;
  const errorBox = $('#student-error');
  const button = form.querySelector('button[type="submit"]');
  const id = fields.record_id.value;

  const body = {
    display_name: fields.display_name.value,
    username: fields.username.value,
    level_id: fields.level_id.value || null,
  };

  if (fields.password.value) body.password = fields.password.value;
  if (id) body.is_active = fields.is_active.checked;

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    await api(id ? `/api/admin/students/${id}` : '/api/admin/students', {
      method: id ? 'PATCH' : 'POST',
      body,
    });

    $('#student-dialog').close();
    toast(id ? 'تم تعديل بيانات الطالب ✅' : 'تمت إضافة الطالب ✅');
    await reloadData();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function toggleStudent(student) {
  try {
    await api(`/api/admin/students/${student.id}`, {
      method: 'PATCH',
      body: {
        display_name: student.display_name,
        is_active: !student.is_active,
      },
    });

    toast(student.is_active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب ✅');
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteStudent(student) {
  const confirmed = confirm(
    `متأكد إنك عايز تحذف «${student.display_name}»؟ الحساب هيتشال نهائيًا.`
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/students/${student.id}`, { method: 'DELETE' });
    toast('تم حذف الطالب');
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------- المستويات ------------------------------- */

async function loadLevels() {
  const box = $('#levels-box');

  try {
    const { levels } = await api('/api/admin/levels', { cacheKey: 'admin-levels' });
    state.levels = levels;
    renderLevels();
    fillLevelFilters();
    renderLessonsAdmin();
  } catch (error) {
    if (error.status === 401) return;
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مش قادر أجيب المستويات' }),
        error.message,
      ])
    );
    toast(error.message, 'error');
  }
}

function lessonRow(lesson) {
  const filesCount = Array.isArray(lesson.files) ? lesson.files.length : 0;

  return el('div', { class: 'lesson-admin' }, [
    el('strong', { text: lesson.title }),
    el('div', { class: 'row-actions' }, [
      el(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => openFilesDialog(lesson),
        },
        `المرفقات (${filesCount})`
      ),
      el(
        'button',
        { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openLessonDialog(lesson.level_id, lesson) },
        'تعديل'
      ),
      el(
        'button',
        { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteLesson(lesson) },
        'حذف'
      ),
    ]),
  ]);
}

function assessmentRow(level, assessment) {
  return el('div', { class: 'lesson-admin' }, [
    el('strong', { text: assessment.title }),
    el('span', { class: 'badge badge-muted', text: `من ${assessment.max_score}` }),
    el('div', { class: 'row-actions' }, [
      el(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => openAssessmentDialog(level.id, assessment),
        },
        'تعديل'
      ),
      el(
        'button',
        { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteAssessment(assessment) },
        'حذف'
      ),
    ]),
  ]);
}

function levelCard(level) {
  const lessons = level.lessons.length
    ? level.lessons.map(lessonRow)
    : [el('p', { class: 'muted small', text: 'مفيش دروس في المستوى ده لسه.' })];

  const assessments = level.assessments.length
    ? level.assessments.map((assessment) => assessmentRow(level, assessment))
    : [el('p', { class: 'muted small', text: 'مفيش تقييمات في المستوى ده لسه.' })];

  return el('div', { class: 'level-card' }, [
    el('div', { class: 'level-head' }, [
      el('div', {}, [
        el('h4', { text: level.name }),
        level.description ? el('p', { class: 'muted small', text: level.description }) : null,
      ]),
      el('span', { class: 'badge', text: `${level.students_count} طالب` }),
      el('div', { class: 'spacer' }),
      el('div', { class: 'row-actions' }, [
        el(
          'button',
          { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openLessonDialog(level.id) },
          '+ درس'
        ),
        el(
          'button',
          { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openLevelDialog(level) },
          'تعديل'
        ),
        el(
          'button',
          { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteLevel(level) },
          'حذف'
        ),
      ]),
    ]),
    el('div', {}, lessons),
    el('div', { class: 'level-assessments' }, [
      el('div', { class: 'level-subhead' }, [
        el('strong', { text: 'التقييمات والدرجات' }),
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            onclick: () => openAssessmentDialog(level.id),
          },
          '+ تقييم'
        ),
      ]),
      ...assessments,
    ]),
  ]);
}

function renderLevels() {
  const box = $('#levels-box');

  if (!state.levels.length) {
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'لسه مفيش مستويات' }),
        'اعمل أول مستوى من زرار «مستوى جديد» وبعدها ضيف له الدروس.',
      ])
    );
    return;
  }

  box.replaceChildren(...state.levels.map(levelCard));
}

function openLevelDialog(level = null) {
  const form = $('#level-form');
  const fields = form.elements;

  form.reset();
  fields.record_id.value = level?.id || '';
  fields.name.value = level?.name || '';
  fields.description.value = level?.description || '';
  fields.sort_order.value = String(level?.sort_order ?? state.levels.length + 1);

  $('#level-dialog-title').textContent = level ? 'تعديل المستوى' : 'مستوى جديد';
  $('#level-error').textContent = '';

  $('#level-dialog').showModal();
}

async function saveLevel(event) {
  event.preventDefault();

  const form = $('#level-form');
  const fields = form.elements;
  const errorBox = $('#level-error');
  const button = form.querySelector('button[type="submit"]');
  const id = fields.record_id.value;

  const body = {
    name: fields.name.value,
    description: fields.description.value,
    sort_order: Number(fields.sort_order.value) || 0,
  };

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    await api(id ? `/api/admin/levels/${id}` : '/api/admin/levels', {
      method: id ? 'PATCH' : 'POST',
      body,
    });

    $('#level-dialog').close();
    toast(id ? 'تم تعديل المستوى ✅' : 'تمت إضافة المستوى ✅');
    await reloadData();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function deleteLevel(level) {
  const confirmed = confirm(
    `حذف المستوى «${level.name}»؟ دروسه (${level.lessons.length}) وتقييماته (${level.assessments.length}) هتتمسح معاه، والطلاب هيفضلوا بدون مستوى.`
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/levels/${level.id}`, { method: 'DELETE' });
    toast('تم حذف المستوى');
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* --------------------------- التقييمات والدرجات --------------------------- */

function openAssessmentDialog(levelId, assessment = null) {
  const form = $('#assessment-form');
  const fields = form.elements;

  form.reset();
  fields.record_id.value = assessment?.id || '';
  fields.level_id.value = String(levelId);
  fields.title.value = assessment?.title || '';
  fields.max_score.value = String(assessment?.max_score ?? 100);
  fields.sort_order.value = String(assessment?.sort_order ?? 0);

  $('#assessment-dialog-title').textContent = assessment ? 'تعديل التقييم' : 'تقييم جديد';
  $('#assessment-error').textContent = '';

  $('#assessment-dialog').showModal();
}

async function saveAssessment(event) {
  event.preventDefault();

  const form = $('#assessment-form');
  const fields = form.elements;
  const errorBox = $('#assessment-error');
  const button = form.querySelector('button[type="submit"]');
  const id = fields.record_id.value;

  const body = {
    level_id: Number(fields.level_id.value),
    title: fields.title.value,
    max_score: Number(fields.max_score.value),
    sort_order: Number(fields.sort_order.value) || 0,
  };

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    await api(id ? `/api/admin/assessments/${id}` : '/api/admin/assessments', {
      method: id ? 'PATCH' : 'POST',
      body,
    });

    $('#assessment-dialog').close();
    toast(id ? 'تم تعديل التقييم ✅' : 'تمت إضافة التقييم ✅');
    await reloadData();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function deleteAssessment(assessment) {
  const confirmed = confirm(
    `حذف تقييم «${assessment.title}»؟ كل الدرجات المرصودة عليه هتتمسح.`
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/assessments/${assessment.id}`, { method: 'DELETE' });
    toast('تم حذف التقييم');
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openGradesDialog(student) {
  if (!student.level_id) {
    toast('الطالب ملوش مستوى، حددله مستوى الأول عشان ترصد درجاته.', 'error');
    return;
  }

  const box = $('#grades-form-box');
  const errorBox = $('#grades-error');
  const button = $('#save-grades-btn');

  $('#grades-dialog-title').textContent = `درجات ${student.display_name}`;
  $('#grades-hint').textContent = `المستوى: ${student.level_name || '—'}`;
  errorBox.textContent = '';
  button.dataset.studentId = String(student.id);
  button.disabled = true;
  box.replaceChildren(el('p', { class: 'loading', text: 'بنحمّل الدرجات…' }));

  $('#grades-dialog').showModal();

  try {
    const data = await api(`/api/admin/students/${student.id}/grades`);

    if (!data.assessments.length) {
      box.replaceChildren(
        el('div', { class: 'empty' }, [
          el('strong', { text: 'مفيش تقييمات في مستوى الطالب' }),
          'ضيف تقييم من تبويب «المستويات والدروس» الأول.',
        ])
      );
      return;
    }

    const rows = data.assessments.map((assessment) => {
      const input = el('input', {
        type: 'number',
        min: '0',
        max: String(assessment.max_score),
        step: '0.5',
        'data-assessment-id': String(assessment.id),
        'aria-label': `درجة ${assessment.title}`,
      });

      if (assessment.score !== null && assessment.score !== undefined) {
        input.value = String(assessment.score);
      }

      return el('div', { class: 'grade-edit-row' }, [
        el('strong', { text: assessment.title }),
        el('span', { class: 'max', text: `من ${assessment.max_score}` }),
        input,
      ]);
    });

    box.replaceChildren(el('div', { class: 'grade-edit-list' }, rows));
    button.disabled = false;
  } catch (error) {
    box.replaceChildren();
    errorBox.textContent = error.message;
  }
}

async function saveGrades() {
  const button = $('#save-grades-btn');
  const errorBox = $('#grades-error');
  const studentId = Number(button.dataset.studentId);
  const inputs = $$('#grades-form-box input[data-assessment-id]');

  if (!studentId || !inputs.length) return;

  // نتحقق من كل القيم الأول عشان منحفظش نص الدرجات ونفشل في النص
  for (const input of inputs) {
    const raw = input.value.trim();
    if (raw === '') continue;

    const value = Number(raw);
    const max = Number(input.max);

    if (!Number.isFinite(value) || value < 0 || value > max) {
      errorBox.textContent = `الدرجة في «${input.getAttribute('aria-label')}» لازم تكون من 0 لـ ${max}`;
      input.focus();
      return;
    }
  }

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    for (const input of inputs) {
      const raw = input.value.trim();

      await api('/api/admin/grades', {
        method: 'POST',
        body: {
          student_id: studentId,
          assessment_id: Number(input.dataset.assessmentId),
          score: raw === '' ? null : Number(raw),
        },
      });
    }

    $('#grades-dialog').close();
    toast('تم حفظ درجات الطالب ✅');
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

/* --------------------------------- الدروس --------------------------------- */

function openLessonDialog(levelId, lesson = null) {
  const form = $('#lesson-form');
  const fields = form.elements;

  form.reset();
  fields.record_id.value = lesson?.id || '';
  fillLevelSelect(fields.level_id, lesson?.level_id ?? levelId);
  fields.title.value = lesson?.title || '';
  fields.content.value = lesson?.content || '';
  fields.video_url.value = lesson?.video_url || '';
  fields.sort_order.value = String(lesson?.sort_order ?? 0);

  $('#lesson-dialog-title').textContent = lesson ? 'تعديل الدرس' : 'درس جديد';
  $('#lesson-error').textContent = '';

  $('#lesson-form-dialog').showModal();
}

async function saveLesson(event) {
  event.preventDefault();

  const form = $('#lesson-form');
  const fields = form.elements;
  const errorBox = $('#lesson-error');
  const button = form.querySelector('button[type="submit"]');
  const id = fields.record_id.value;

  const body = {
    level_id: fields.level_id.value || null,
    title: fields.title.value,
    content: fields.content.value,
    video_url: fields.video_url.value,
    sort_order: Number(fields.sort_order.value) || 0,
  };

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    await api(id ? `/api/admin/lessons/${id}` : '/api/admin/lessons', {
      method: id ? 'PATCH' : 'POST',
      body,
    });

    $('#lesson-form-dialog').close();
    toast(id ? 'تم تعديل الدرس ✅' : 'تمت إضافة الدرس ✅');
    await reloadData();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function deleteLesson(lesson) {
  const filesCount = Array.isArray(lesson.files) ? lesson.files.length : 0;
  const confirmed = confirm(
    `حذف درس «${lesson.title}»؟${filesCount ? ` ومرفقاته (${filesCount}) هتتمسح معاه.` : ''}`
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE' });
    toast('تم حذف الدرس');
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ----------------------------- مرفقات الدروس ----------------------------- */

let filesLesson = null;

function renderFilesDialog(lesson) {
  const box = $('#files-list-box');
  const files = Array.isArray(lesson.files) ? lesson.files : [];

  if (!files.length) {
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مفيش مرفقات في الدرس ده' }),
        'ارفع أول محاضرة/ملف من الفورم اللي فوق.',
      ])
    );
    return;
  }

  const list = el('div', { class: 'file-list' });

  for (const file of files) {
    list.append(
      el('div', { class: 'file-item' }, [
        el('span', { class: 'file-icon', text: '📎' }),
        el('span', { class: 'file-text' }, [
          el('strong', { text: file.original_name }),
          el('small', { text: `${formatFileSize(file.size)} — ${formatDate(file.uploaded_at)}` }),
        ]),
        el('a', {
          class: 'btn btn-sm btn-ghost',
          href: `/api/files/${file.id}`,
          download: file.original_name,
        }, 'تحميل'),
        el(
          'button',
          {
            class: 'btn btn-sm btn-danger',
            type: 'button',
            onclick: () => deleteFile(file),
          },
          'حذف'
        ),
      ])
    );
  }

  box.replaceChildren(list);
}

async function refreshFilesDialog() {
  if (!filesLesson) return;

  const box = $('#files-list-box');
  box.replaceChildren(el('p', { class: 'loading', text: 'بنحمّل المرفقات…' }));

  try {
    const { levels } = await api('/api/admin/levels');

    const lesson = levels
      .flatMap((level) => level.lessons)
      .find((item) => item.id === filesLesson.id);

    if (!lesson) {
      box.replaceChildren(el('p', { class: 'muted', text: 'الدرس ده اتحذف.' }));
      return;
    }

    filesLesson = lesson;
    state.levels = levels;
    renderFilesDialog(lesson);
  } catch (error) {
    box.replaceChildren(el('p', { class: 'form-error', text: error.message }));
  }
}

function openFilesDialog(lesson) {
  filesLesson = lesson;

  $('#files-dialog-title').textContent = `مرفقات: ${lesson.title}`;
  $('#upload-form').reset();
  $('#upload-error').textContent = '';
  $('#files-list-box').replaceChildren();

  $('#files-dialog').showModal();

  renderFilesDialog(lesson);
}

async function uploadFile(event) {
  event.preventDefault();

  if (!filesLesson) return;

  const input = $('#upload-input');
  const button = $('#upload-btn');
  const errorBox = $('#upload-error');
  const file = input.files?.[0];

  if (!file) {
    errorBox.textContent = 'اختار ملف الأول';
    return;
  }

  errorBox.textContent = '';
  setBusy(button, true, 'بيرفع…');

  try {
    await apiUpload(`/api/admin/lessons/${filesLesson.id}/files`, file);
    $('#upload-form').reset();
    toast('تم رفع الملف ✅');
    await refreshFilesDialog();
    await reloadData();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function deleteFile(file) {
  const confirmed = confirm(`حذف الملف «${file.original_name}»؟`);
  if (!confirmed) return;

  try {
    await api(`/api/admin/files/${file.id}`, { method: 'DELETE' });
    toast('تم حذف الملف');
    await refreshFilesDialog();
    await reloadData();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------ إدارة الدروس ------------------------------ */

function fillLevelFilters() {
  const filter = $('#lessons-level-filter');
  const sheetSelect = $('#sheet-level-select');
  if (!filter || !sheetSelect) return;

  const previousFilter = filter.value;
  const previousSheet = sheetSelect.value;

  filter.replaceChildren(
    el('option', { value: '' }, 'كل المستويات'),
    ...state.levels.map((level) =>
      el('option', { value: String(level.id) }, level.name)
    )
  );

  if (previousFilter && state.levels.some((level) => String(level.id) === previousFilter)) {
    filter.value = previousFilter;
  }

  sheetSelect.replaceChildren(
    ...state.levels.map((level) => el('option', { value: String(level.id) }, level.name))
  );

  if (previousSheet && state.levels.some((level) => String(level.id) === previousSheet)) {
    sheetSelect.value = previousSheet;
  }
}

function renderLessonsAdmin() {
  const box = $('#lessons-admin-box');
  if (!box) return;

  if (!state.levels.length) {
    box.replaceChildren(
      el('div', { class: 'empty' }, [
        el('strong', { text: 'مفيش مستويات لسه' }),
        'ضيف مستوى الأول من تبويب «المستويات» وبعدها تقدر تضيف دروس.',
      ])
    );
    return;
  }

  const levels = state.lessonsLevelId
    ? state.levels.filter((level) => level.id === state.lessonsLevelId)
    : state.levels;

  const cards = levels.map((level) => {
    const lessons = level.lessons.length
      ? level.lessons.map(lessonRow)
      : [el('p', { class: 'muted small', text: 'مفيش دروس في المستوى ده لسه.' })];

    return el('div', { class: 'level-card' }, [
      el('div', { class: 'level-head' }, [
        el('div', {}, [
          el('h4', { text: level.name }),
          el('p', { class: 'muted small', text: `${level.lessons.length} درس` }),
        ]),
        el('div', { class: 'spacer' }),
        el('div', { class: 'row-actions' }, [
          el(
            'button',
            {
              class: 'btn btn-sm btn-primary',
              type: 'button',
              onclick: () => openLessonDialog(level.id),
            },
            '+ درس'
          ),
        ]),
      ]),
      el('div', {}, lessons),
    ]);
  });

  box.replaceChildren(...cards);
}

function openNewLesson() {
  const fromFilter = Number($('#lessons-level-filter').value);
  const levelId = fromFilter || state.levels[0]?.id;

  if (!levelId) {
    toast('ضيف مستوى الأول عشان تقدر تضيف دروس', 'error');
    return;
  }

  openLessonDialog(levelId);
}

/* ---------------------------- شيت الدرجات ---------------------------- */

function sheetEmpty(title, text) {
  return el('div', { class: 'empty' }, [
    el('strong', { text: title }),
    text,
  ]);
}

async function loadSheet() {
  const box = $('#sheet-box');
  const errorBox = $('#sheet-error');
  const hint = $('#sheet-hint');
  const select = $('#sheet-level-select');

  if (!box || !hint) return;

  errorBox.textContent = '';

  let levelId = Number(select?.value) || state.levels[0]?.id;
  if (!levelId) {
    hint.textContent = '';
    box.className = '';
    box.replaceChildren(sheetEmpty('مفيش مستويات', 'ضيف مستوى وطلاب وتقييمات الأول.'));
    return;
  }

  if (select) select.value = String(levelId);

  box.className = 'loading';
  box.replaceChildren('بنحمّل الشيت…');

  try {
    const data = await api(`/api/admin/levels/${levelId}/sheet`);
    state.sheet = data;
    renderSheet();
  } catch (error) {
    state.sheet = null;
    box.className = '';
    box.replaceChildren(sheetEmpty('مش قادر أجيب الشيت', error.message));
  }
}

function renderSheet() {
  const box = $('#sheet-box');
  const hint = $('#sheet-hint');
  const data = state.sheet;

  if (!box || !data) return;

  hint.textContent = `${data.level.name} — ${data.students.length} طالب × ${data.assessments.length} تقييم`;

  if (!data.assessments.length) {
    box.className = '';
    box.replaceChildren(
      sheetEmpty('مفيش تقييمات في المستوى ده', 'ضيف تقييم من تبويب «المستويات» الأول.')
    );
    return;
  }

  if (!data.students.length) {
    box.className = '';
    box.replaceChildren(sheetEmpty('مفيش طلاب في المستوى ده', 'حدد مستوى الطلاب الأول من تبويب «الطلاب».'));
    return;
  }

  const table = el('table', { class: 'sheet-table' });
  const headRow = el('tr');

  headRow.append(el('th', { class: 'sheet-name-col', text: 'الطالب' }));
  for (const assessment of data.assessments) {
    headRow.append(
      el('th', {}, [
        el('span', { text: assessment.title }),
        el('small', { text: `من ${assessment.max_score}` }),
      ])
    );
  }
  headRow.append(el('th', { text: 'المجموع' }), el('th', { text: 'النسبة' }));

  const thead = el('thead', {}, [headRow]);
  const tbody = el('tbody');

  for (const student of data.students) {
    const row = el('tr');

    row.append(
      el('td', { class: 'sheet-name-col' }, [
        el('strong', { text: student.display_name }),
        el('code', { text: '@' + student.username }),
      ])
    );

    const totalCell = el('td', { class: 'sheet-total' });
    const percentCell = el('td', { class: 'sheet-percent' });

    for (const assessment of data.assessments) {
      const input = el('input', {
        type: 'number',
        min: '0',
        max: String(assessment.max_score),
        step: '0.5',
        dir: 'ltr',
        'data-student-id': String(student.id),
        'data-assessment-id': String(assessment.id),
        'aria-label': `درجة ${student.display_name} في ${assessment.title}`,
      });

      const saved = student.scores?.[assessment.id];
      if (saved !== undefined && saved !== null) input.value = String(saved);

      row.append(el('td', { class: 'sheet-cell' }, [input]));
    }

    const recalc = () => {
      let score = 0;
      let max = 0;

      for (const assessment of data.assessments) {
        const input = row.querySelector(
          `input[data-assessment-id="${assessment.id}"]`
        );
        const raw = input?.value.trim();
        if (!raw) continue;

        const value = Number(raw);
        if (!Number.isFinite(value)) continue;

        score += value;
        max += assessment.max_score;
      }

      totalCell.textContent = max
        ? `${Math.round(score * 100) / 100} / ${Math.round(max * 100) / 100}`
        : '—';
      percentCell.textContent = max
        ? `${Math.round((score / max) * 1000) / 10}%`
        : '—';
    };

    for (const input of row.querySelectorAll('input[data-assessment-id]')) {
      input.addEventListener('input', recalc);
    }

    row.append(totalCell, percentCell);
    tbody.append(row);
    recalc();
  }

  table.append(thead, tbody);

  box.className = '';
  box.replaceChildren(el('div', { class: 'sheet-wrap' }, [table]));
}

async function saveSheet() {
  if (!state.sheet) return;

  const errorBox = $('#sheet-error');
  const button = $('#sheet-save-btn');
  const inputs = $$('#sheet-box input[data-assessment-id]');

  if (!inputs.length) return;

  for (const input of inputs) {
    const raw = input.value.trim();
    if (!raw) continue;

    const value = Number(raw);
    const max = Number(input.max);

    if (!Number.isFinite(value) || value < 0 || value > max) {
      errorBox.textContent = `الدرجة في «${input.getAttribute('aria-label')}» لازم تكون من 0 لـ ${max}`;
      input.focus();
      return;
    }
  }

  const grades = inputs.map((input) => ({
    student_id: Number(input.dataset.studentId),
    assessment_id: Number(input.dataset.assessmentId),
    score: input.value.trim() === '' ? null : Number(input.value),
  }));

  errorBox.textContent = '';
  setBusy(button, true, 'بيحفظ…');

  try {
    await api(`/api/admin/levels/${state.sheet.level.id}/grades`, {
      method: 'POST',
      body: { grades },
    });

    toast('تم حفظ الشيت ✅');
    await loadSheet();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportSheetCsv() {
  const data = state.sheet;

  if (!data) {
    toast('افتح الشيت الأول', 'error');
    return;
  }

  if (!data.assessments.length) {
    toast('مفيش تقييمات تتصدّر', 'error');
    return;
  }

  const inputs = $$('#sheet-box input[data-assessment-id]');
  const header = [
    'اسم الطالب',
    'اسم المستخدم',
    ...data.assessments.map(
      (assessment) => `${assessment.title} (من ${assessment.max_score})`
    ),
    'المجموع',
    'النسبة',
  ];

  const rows = [header.map(csvCell).join(',')];

  for (const student of data.students) {
    let score = 0;
    let max = 0;

    const cells = data.assessments.map((assessment) => {
      const input = inputs.find(
        (item) =>
          item.dataset.studentId === String(student.id) &&
          item.dataset.assessmentId === String(assessment.id)
      );

      const raw = input?.value.trim() ?? '';
      if (!raw) return '';

      const value = Number(raw);
      if (!Number.isFinite(value)) return '';

      score += value;
      max += assessment.max_score;
      return value;
    });

    rows.push(
      [
        student.display_name,
        student.username,
        ...cells,
        max ? `${Math.round(score * 100) / 100} / ${Math.round(max * 100) / 100}` : '',
        max ? `${Math.round((score / max) * 1000) / 10}%` : '',
      ]
        .map(csvCell)
        .join(',')
    );
  }

  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const safeName = String(data.level.name).replace(/[\\/:*?"<>|]/g, '-');
  const link = el('a', { href: url, download: `شيت-درجات-${safeName}.csv` });

  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast('تم تصدير الشيت ✅');
}

/* --------------------------------- التهيئة -------------------------------- */

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;

      $$('.tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      $$('.panel').forEach((panel) => {
        panel.hidden = panel.id !== `panel-${name}`;
      });

      if (name === 'lessons') {
        fillLevelFilters();
        renderLessonsAdmin();
      }

      if (name === 'sheet') {
        fillLevelFilters();
        loadSheet();
      }
    });
  });
}

function bindEvents() {
  $('#add-student-btn').addEventListener('click', () => openStudentDialog());
  $('#add-level-btn').addEventListener('click', () => openLevelDialog());
  $('#add-lesson-btn').addEventListener('click', openNewLesson);
  $('#student-form').addEventListener('submit', saveStudent);
  $('#level-form').addEventListener('submit', saveLevel);
  $('#lesson-form').addEventListener('submit', saveLesson);
  $('#assessment-form').addEventListener('submit', saveAssessment);
  $('#save-grades-btn').addEventListener('click', saveGrades);
  $('#upload-form').addEventListener('submit', uploadFile);

  $('#lessons-level-filter').addEventListener('change', (event) => {
    state.lessonsLevelId = Number(event.target.value) || '';
    renderLessonsAdmin();
  });

  $('#sheet-level-select').addEventListener('change', loadSheet);
  $('#sheet-refresh-btn').addEventListener('click', loadSheet);
  $('#sheet-save-btn').addEventListener('click', saveSheet);
  $('#sheet-export-btn').addEventListener('click', exportSheetCsv);

  $('#student-search').addEventListener('input', (event) => {
    state.filter = event.target.value;
    renderStudents();
  });

  $('#logout-btn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* تجاهل */
    }
    Cache.clear();
    window.location.href = '/';
  });
}

async function init() {
  wireDialogs();
  bindTabs();
  bindEvents();

  await Cache.syncVersion();

  let user;

  try {
    ({ user } = await api('/api/me', { cacheKey: 'me' }));
  } catch (error) {
    if (!error.status) toast(error.message, 'error');
    return;
  }

  if (user.role !== 'admin') {
    window.location.replace('/dashboard');
    return;
  }

  $('#avatar').textContent = initials(user.display_name);
  $('#user-name').textContent = user.display_name;
  $('#user-username').textContent = '@' + user.username;

  await Promise.all([loadStudents(), loadLevels()]);
  fillLevelFilters();
  renderLessonsAdmin();
}

init();
