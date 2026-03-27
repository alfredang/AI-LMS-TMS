fetch('http://localhost:3000/api/admin/ongoing-classes')
  .then(res => res.json())
  .then(data => {
    const cls = data.data.classes.find(c => c.courseRunId === '1227873');
    console.log("TRAINER FOR 1227873:", cls.trainerName);
  });
