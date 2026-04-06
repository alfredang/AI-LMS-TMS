const EVENING_COURSE_CODES = new Set([
  "TGS-2025053916",
  "TGS-2024043420",
  "TGS-2024049215",
  "TGS-2024051421",
  "TGS-2024052084",
  "TGS-2025053210",
  "TGS-2025053924",
  "TGS-2025053923",
  "TGS-2025054485",
  "TGS-2025056191",
  "TGS-2025060473",
  "TGS-2025060472",
  "TGS-2025052468",
  "TGS-2024048310",
  "TGS-2025052341",
  "TGS-2020505317",
  "TGS-2020505315",
  "TGS-2020503531",
  "TGS-2020504243",
  "TGS-2020505113",
  "TGS-2020503395",
  "TGS-2020503626",
  "TGS-2020503676",
  "TGS-2020503771",
  "TGS-2020505790",
  "TGS-2020506075",
  "TGS-2021002619",
  "TGS-2021007827",
  "TGS-2021010195",
  "TGS-2022015374",
  "TGS-2022015367",
  "TGS-2020503869",
  "TGS-2020504518",
  "TGS-2020504706"
]);

function getConfirmedRows() {
  const sheetName = "SSG DA (Confirmed)";
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error(`❌ Sheet '${sheetName}' not found.`);

  const data = sheet.getDataRange().getValues();
  const header = data[0];

  const colCourseTitle     = header.indexOf("Course Title");
  const colStartDate       = header.indexOf("Course Start Date");
  const colEndDate         = header.indexOf("Course End Date");
  const colCourseCode      = header.indexOf("Course Reference Number");
  const colTraineeEmail    = header.indexOf("Trainee Email");
  const colFinalStatus     = header.indexOf("Final Status");
  const colGoogleCalendar  = header.indexOf("Google Calendar");
  
  const requiredCols = [
    colCourseTitle, colStartDate, colEndDate, colCourseCode, colTraineeEmail,
    colFinalStatus, colGoogleCalendar
  ];

  if (requiredCols.includes(-1)) {
    throw new Error("❌ Missing one or more required columns. Check header names.");
  }

  Logger.log("📌 Filtering rows where Final Status='Confirmed' AND Google Calendar=FALSE");
  Logger.log("--------------------------------------------------");

  const validRows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const courseTitle   = row[colCourseTitle];
    const startDateStr  = row[colStartDate];
    const endDateStr    = row[colEndDate];
    const courseCode    = row[colCourseCode];
    const finalStatus   = row[colFinalStatus];
    const googleCalFlag = row[colGoogleCalendar];
    const traineeEmail = row[colTraineeEmail];
    const isConfirmed = finalStatus === "Confirmed";
    const notInCalendar = googleCalFlag !== true;

    if (isConfirmed && notInCalendar) {

      Logger.log(`ROW ${i + 1} MATCHED`);
      Logger.log(`  • Course Title:      ${courseTitle}`);
      Logger.log(`  • Course Code:       ${courseCode}`)
      Logger.log(`  • Start Date:        ${startDateStr}`);
      Logger.log(`  • End Date:          ${endDateStr}`);
      Logger.log(`  • Final Status:      ${finalStatus}`);
      Logger.log(`  • Google Calendar:   ${googleCalFlag}`);
      Logger.log("--------------------------------------------------");

      validRows.push({
        rowNumber: i + 1,
        title: courseTitle,
        courseCode: courseCode,
        startDateStr: String(startDateStr),
        endDateStr: String(endDateStr),
        traineeEmail: traineeEmail
      });
    }
  }

  Logger.log("🎉 Completed filtering.");
  return validRows;
}

// 🔧 ADDED (write-back helper)
function markGoogleCalendarTrue(sheet, rowNumber, colGoogleCalendar) {
  sheet.getRange(rowNumber, colGoogleCalendar + 1).setValue(true);
}

/***************************************
 * LOG EXISTING ATTENDEES (API)
 ***************************************/
function logExistingAttendeesViaAPI(eventId, calendarId) {
  try {
    var apiEvent = Calendar.Events.get(calendarId, eventId);
    var attendees = apiEvent.attendees || [];

    if (attendees.length === 0) {
      Logger.log("👥 [API] No attendees found for event: " + eventId);
      return;
    }

    Logger.log("👥 [API] Existing attendees for event " + eventId + ":");
    attendees.forEach((attendee, i) => {
      Logger.log(
        "  " + (i + 1) + ". " +
        attendee.email +
        (attendee.responseStatus ? " (" + attendee.responseStatus + ")" : "")
      );
    });
  } catch (err) {
    Logger.log("❌ Failed to fetch attendees via API: " + err);
  }
}

/***************************************
 * ADD ATTENDEE (API-SAFE DEDUPLICATION)
 ***************************************/
function addAttendeeToEvent(eventId, emailAddress, calendarId) {

  if (!eventId || !emailAddress) return;

  // 🔍 Debug: print existing attendees
  logExistingAttendeesViaAPI(eventId, calendarId);

  // 🔍 SOURCE OF TRUTH — Calendar API
  var apiEvent = Calendar.Events.get(calendarId, eventId);
  var apiAttendees = apiEvent.attendees || [];

  var alreadyExists = apiAttendees.some(a =>
    a.email && a.email.toLowerCase() === emailAddress.toLowerCase()
  );

  if (alreadyExists) {
    Logger.log("👤 Attendee already exists (API): " + emailAddress);
    return;
  }

  // Build attendee list
  var attendees = apiAttendees.map(a => ({ email: a.email }));
  attendees.push({ email: emailAddress });

  Logger.log("➕ Adding attendee to event: "+ emailAddress + " " + eventId);

  Calendar.Events.patch(
    { attendees: attendees },
    calendarId,
    eventId,
    { sendUpdates: "all" }
  );
}

/***************************************
 * BUILD COURSE DAYS LOOKUP (SKILLSET)
 ***************************************/
function getCourseDaysFromSkillset() {
  const sheetName = "Skillset"; // 🔴 adjust if your sheet name differs
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error(`❌ Sheet '${sheetName}' not found`);

  const data = sheet.getDataRange().getValues();
  const header = data[0];

  const colCourseCode = header.indexOf("Course Code");
  const colNumDays    = header.indexOf("Number Of Days");

  if (colCourseCode === -1 || colNumDays === -1) {
    throw new Error("❌ Skillset sheet missing required columns");
  }

  const map = new Map();

  for (let i = 1; i < data.length; i++) {
    const code = String(data[i][colCourseCode]).trim();
    const days = Number(data[i][colNumDays]);

    if (code && !isNaN(days)) {
      map.set(code, days);
    }
  }

  return map; // Map<courseCode, officialDays>
}

// 🔍 Load official course durations once
const SKILLSET_DAYS_MAP = getCourseDaysFromSkillset();

/***************************************
 * MAIN FUNCTION
 ***************************************/
function add_trainee_for_calendar() {
  var calendarId = "sales@tertiarycourses.com.sg";

  var sheet = SpreadsheetApp.getActive().getSheetByName("SSG DA (Confirmed)");
  var header = sheet.getDataRange().getValues()[0];
  var colGoogleCalendar = header.indexOf("Google Calendar");

  var valid_data = getConfirmedRows();
  Logger.log("Rows to process: " + valid_data.length);

  var errorEvents = [];

  for (var i = 0; i < valid_data.length; i++) {

    var row = valid_data[i];

    var courseTitle         = row.title;
    var courseStartYYYYMMDD = row.startDateStr;
    var courseEndYYYYMMDD   = row.endDateStr;

    var traineeEmail = row.traineeEmail;
    var courseCode   = row.courseCode;

    Logger.log("====================================");
    Logger.log("Processing row " + row.rowNumber);
    Logger.log("Course: " + courseTitle);
    Logger.log("Dates: " + courseStartYYYYMMDD + " → " + courseEndYYYYMMDD);

    var startHour = 9, startMinute = 30, endHour = 18, endMinute = 30;

    var isHydroponics = courseTitle.toLowerCase().includes("hydroponics");
    if (isHydroponics) {
      startHour = 9; startMinute = 0; endHour = 18; endMinute = 0;
    }

    var isEveningCourse =
  EVENING_COURSE_CODES.has(courseCode) &&
  courseStartYYYYMMDD !== courseEndYYYYMMDD;

    if (isEveningCourse) {
      startHour = 18;
      startMinute = 0;
      endHour = 22;
      endMinute = 0;

      Logger.log("🌙 Evening class detected (6pm–10pm)");
    }

    var courseTime =
      formatHourMinuteToAmPm(startHour, startMinute) +
      " - " +
      formatHourMinuteToAmPm(endHour, endMinute);

    var startDate = toDate(courseStartYYYYMMDD, startHour, startMinute);
    var endDate   = toDate(courseEndYYYYMMDD, endHour, endMinute);

    var rawCourseDays =
  Math.floor((endDate - startDate) / 86400000) + 1;

    // 
    var courseDays = isEveningCourse ? 1 : rawCourseDays;

    if (courseDays > 5) {
      Logger.log("⛔ SKIPPED: Course exceeds 5 days");

      errorEvents.push({
        rowNumber: row.rowNumber,
        courseTitle: courseTitle,
        courseStartDate: courseStartYYYYMMDD,
        courseEndDate:courseEndYYYYMMDD,
        traineeEmail: traineeEmail,
        reason: "Course duration exceeds 5 days"
      });
      continue;
    }

    const officialDays = SKILLSET_DAYS_MAP.get(courseCode);

    if (!officialDays) {
      Logger.log("⚠️ No Skillset duration found for course code: " + courseCode);

    } else {

      // 🔑 Evening courses span 2 calendar days per Skillset day
      const expectedCalendarDays = isEveningCourse
        ? officialDays * 2
        : officialDays;

      if (rawCourseDays !== expectedCalendarDays) {

        Logger.log(
          "⛔ INVALID COURSE DATES — expected (" +
          expectedCalendarDays +
          ") calendar days but got (" +
          rawCourseDays +
          ")"
        );

        errorEvents.push({
          rowNumber: row.rowNumber,
          courseTitle: courseTitle,
          courseCode: courseCode,
          courseStartDate: courseStartYYYYMMDD,
          courseEndDate:courseEndYYYYMMDD,
          traineeEmail: traineeEmail,
          reason: `Invalid date span: ${rawCourseDays} ≠ expected ${expectedCalendarDays}`
        });

        continue; // 🚫 STOP — no event, no attendee
      }
    }

    var existingEvent = findExistingEvent(
      courseTitle,
      courseTime,
      startDate,
      endDate,
      calendarId
    );

    var eventId;

    if (!existingEvent) {

      // 🟡 SECOND CHECK — legacy/manual events
      var fallbackEventId = findExistingEventByDateCoverage(
        courseTitle,
        courseTime,
        startDate,
        endDate,
        calendarId
      );

      if (fallbackEventId) {
        Logger.log("✅ COURSE EXISTS (DATE COVERAGE) → using eventId: " + fallbackEventId);

        // ✅ ADD ATTENDEE
        addAttendeeToEvent(fallbackEventId, traineeEmail, calendarId);

        // ✅ MARK SHEET
        markGoogleCalendarTrue(sheet, row.rowNumber, colGoogleCalendar);

        Logger.log("📗 Google Calendar marked TRUE for row " + row.rowNumber);
        continue;
      }

      Logger.log("❌ EVENT NOT FOUND → creating new event");

      consecFlag = (rawCourseDays > 1);

      eventId = createNewEvent(
        courseTitle,
        startDate,
        endDate,
        courseTime,
        calendarId,
        consecFlag,
        courseCode
      );

      Logger.log("🆕 Event created: " + eventId);

    } else {
      Logger.log("✅ EVENT FOUND");
      eventId = existingEvent.getId().split("@")[0];
    }

    // ✅ ADD ATTENDEE FOR BOTH CASES
    addAttendeeToEvent(eventId, traineeEmail, calendarId);

    // ✅ MARK SHEET ONLY AFTER ATTENDEE LOGIC
    markGoogleCalendarTrue(sheet, row.rowNumber, colGoogleCalendar);

    Logger.log("📗 Google Calendar marked TRUE for row " + row.rowNumber);
  }

  if (errorEvents.length) {

  Logger.log("❌ Error Events: " + JSON.stringify(errorEvents, null, 2));

  // Build HTML table (your existing code)
  var errorHtml = `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr style="background-color:#f2f2f2;">
          <th>Row</th>
          <th>Course</th>
          <th>Course Code</th>
          <th>Start Date</th>
          <th>End Date</th>
          <th>Trainee Email</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${errorEvents.map(e => `
          <tr>
            <td>${e.rowNumber}</td>
            <td>${e.courseTitle}</td>
            <td>${e.courseCode}</td>
            <td>${e.courseStartDate}</td>
            <td>${e.courseEndDate}</td>
            <td>${e.traineeEmail}</td>
            <td style="color:red;">${e.reason}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

    // 🔐 Hash the content
    var currentHash = hashContent(errorHtml);

    // 🔐 Load last sent hash
    var props = PropertiesService.getScriptProperties();
    var lastHash = props.getProperty("LAST_ERROR_EMAIL_HASH");

    if (currentHash !== lastHash) {

      // ✅ Content changed → send email
      sendErrorEmail(
        "DA Calendar Automation Notification",
        errorHtml
      );

      // ✅ Save new hash
      props.setProperty("LAST_ERROR_EMAIL_HASH", currentHash);

      Logger.log("📧 Error email sent (content changed)");

    } else {
      Logger.log("📭 Error email NOT sent (content unchanged)");
    }
  }

  Logger.log("🎉 Processing complete");
}

function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function findExistingEvent(courseTitle, courseTime, courseStartDate, courseEndDate, calendarId) {

  var calendar = CalendarApp.getCalendarById(calendarId);

  // 🔍 Expand search window so we can see full families
  var searchStart = new Date(courseStartDate);
  searchStart.setDate(searchStart.getDate() - 7);

  var searchEnd = new Date(courseEndDate);
  searchEnd.setDate(searchEnd.getDate() + 7);

  var events = calendar.getEvents(searchStart, searchEnd);

  var expectedTitle = courseTitle.toLowerCase();
  var isHydroponics = expectedTitle.includes("hydroponics");

  var expectedStartHour   = courseStartDate.getHours();
  var expectedStartMinute = courseStartDate.getMinutes();
  var expectedEndHour     = courseEndDate.getHours();
  var expectedEndMinute   = courseEndDate.getMinutes();

  if (isHydroponics) {
    expectedStartHour   = 9;
    expectedStartMinute = 0;
    expectedEndHour     = 18;
    expectedEndMinute   = 0;
  }

  // seriesId -> { minDate, maxDate }
  var families = {};

  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var title = e.getTitle().toLowerCase();

    // Skip Virtual Classes , We Only Implement Physical Class Except Hydroponics Which Is An External Class
    if (title.includes("[virtual]")) continue;
    if (!title.includes(expectedTitle)) continue;

    var start = e.getStartTime();
    var end   = e.getEndTime();

    // ⏱ Strict time match
    if (
      start.getHours()   !== expectedStartHour ||
      start.getMinutes() !== expectedStartMinute ||
      end.getHours()     !== expectedEndHour ||
      end.getMinutes()   !== expectedEndMinute
    ) {
      continue;
    }

    // 🔑 Series root ID
    var seriesId = e.getId().split("@")[0];

    if (!families[seriesId]) {
      families[seriesId] = {
        minDate: start,
        maxDate: start
      };
    } else {
      if (start < families[seriesId].minDate) {
        families[seriesId].minDate = start;
      }
      if (start > families[seriesId].maxDate) {
        families[seriesId].maxDate = start;
      }
    }
  }

  // 🧪 Overlap check WITHIN SAME FAMILY ONLY
    for (var seriesId in families) {
    var fam = families[seriesId];

    Logger.log(
      "Family " + seriesId +
      " runs from " + fam.minDate +
      " to " + fam.maxDate
    );

    var isExactSameCourse =
    dateOnly(courseStartDate) === dateOnly(fam.minDate) &&
    dateOnly(courseEndDate)   === dateOnly(fam.maxDate);

    if (isExactSameCourse) {
      Logger.log("⛔ EXACT SAME COURSE ALREADY EXISTS (DATE MATCH)");
      return calendar.getEventById(seriesId);
    }
  }
  Logger.log("✅ No existing course family found");
  return null;
}

/***************************************
 * FALLBACK: CHECK DATE COVERAGE (GROUPED BY FAMILY)
 * RETURNS eventId IF FOUND
 ***************************************/
function findExistingEventByDateCoverage(
  courseTitle,
  courseTime,
  courseStartDate,
  courseEndDate,
  calendarId
) {

  var calendar = CalendarApp.getCalendarById(calendarId);
  var expectedTitle = courseTitle.toLowerCase();

  // 1️⃣ Required dates
  var requiredDates = [];
  var d = new Date(courseStartDate);
  while (d <= courseEndDate) {
    requiredDates.push(dateOnly(d));
    d.setDate(d.getDate() + 1);
  }

  // 2️⃣ Search window
  var searchStart = new Date(courseStartDate);
  searchStart.setDate(searchStart.getDate() - 1);

  var searchEnd = new Date(courseEndDate);
  searchEnd.setDate(searchEnd.getDate() + 1);

  var events = calendar.getEvents(searchStart, searchEnd);

  // 3️⃣ baseId → { dates:Set, eventId }
  var families = {};

  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var title = e.getTitle().toLowerCase();

    if (!title.includes(expectedTitle)) continue;

    var timeRange = formatTimeRange(
      e.getStartTime(),
      e.getEndTime()
    );

    if (timeRange !== courseTime) continue;

    // 🔑 BASE FAMILY ID (parent before "_")
    var baseId = e.getId().split("@")[0].split("_")[0];

    if (!families[baseId]) {
      families[baseId] = {
        dates: new Set(),
        eventId: baseId
      };
    }

    families[baseId].dates.add(dateOnly(e.getStartTime()));
  }

  // 4️⃣ Validate coverage
  for (var baseId in families) {
    var fam = families[baseId];

    Logger.log(
      "Checking family " + baseId +
      " covering dates: " + Array.from(fam.dates).join(", ")
    );

    var allCovered = requiredDates.every(d => fam.dates.has(d));

    if (allCovered) {
      Logger.log(
        "🟡 EXISTING COURSE FOUND (FAMILY DATE COVERAGE MATCH) → eventId: " +
        fam.eventId
      );
      return fam.eventId; // ✅ RETURN EVENT ID
    }
  }

  return null;
}



/***************************************
 * TIME FORMATTERS
 ***************************************/
function formatHourMinuteToAmPm(hour, minute) {
  var ap = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  return hour + ":" + String(minute).padStart(2, "0") + ap;
}

function formatTimeRange(startTime, endTime) {
  return (
    formatHourMinuteToAmPm(startTime.getHours(), startTime.getMinutes()) +
    " - " +
    formatHourMinuteToAmPm(endTime.getHours(), endTime.getMinutes())
  );
}

/***************************************
 * YYYYMMDD → Date
 ***************************************/
function toDate(yyyymmdd, hour, minute) {
  return new Date(
    Number(yyyymmdd.substring(0, 4)),
    Number(yyyymmdd.substring(4, 6)) - 1,
    Number(yyyymmdd.substring(6, 8)),
    hour,
    minute
  );
}

function createNewEvent(
  courseTitle,
  startDate,
  endDate,
  courseTime,
  calendarId,
  consecFlag,
  courseCode
) {
  
  var calendar = CalendarApp.getCalendarById(calendarId);
  var fullCourseTitle = "WSQ - " + courseTitle;

  // End time must follow endDate time but same day for recurrence
  var endTime = new Date(startDate);
  endTime.setHours(endDate.getHours(), endDate.getMinutes());

  // Helper: JS Date → Calendar weekday
  function findWeekday(date) {
    switch (date.getDay()) {
      case 1: return CalendarApp.Weekday.MONDAY;
      case 2: return CalendarApp.Weekday.TUESDAY;
      case 3: return CalendarApp.Weekday.WEDNESDAY;
      case 4: return CalendarApp.Weekday.THURSDAY;
      case 5: return CalendarApp.Weekday.FRIDAY;
      case 6: return CalendarApp.Weekday.SATURDAY;
      case 0: return CalendarApp.Weekday.SUNDAY;
    }
  }

  /* ==================================================
   * 1️⃣ MULTI-DAY CONSECUTIVE COURSE
   * ================================================== */
  if (consecFlag === true) {
    Logger.log("📅 Creating multi-day consecutive event");

    var weekdays = [];
    var currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      weekdays.push(findWeekday(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    var recurrence = CalendarApp.newRecurrence()
      .addWeeklyRule()
      .onlyOnWeekdays(weekdays)
      .until(endDate);

    var eventSeries = calendar.createEventSeries(
      "*" + fullCourseTitle,
      startDate,
      endTime,
      recurrence,
      { description: courseCode || "" }
    );

    changeEventColor(eventSeries, courseTitle);
    changeLocation(eventSeries, courseTitle);
    eventSeries.setGuestsCanInviteOthers(false);
    eventSeries.setGuestsCanModify(false);
    eventSeries.setGuestsCanSeeGuests(false);

    // ✅ UNIQUE SERIES ROOT ID
    var seriesEventId = eventSeries.getId().split("@")[0];

    // ✅ Rename ONLY instances of THIS series
    renameCreatedCourseDays(
      calendar,
      seriesEventId,
      fullCourseTitle,
      courseTime,
      startDate,
      endDate
    );

    return seriesEventId;
  }

  /* ==================================================
   * 2️⃣ SINGLE-DAY COURSE
   * ================================================== */
  Logger.log("📅 Creating single-day event");

  var event = calendar.createEvent(
    "*" + fullCourseTitle,
    startDate,
    endDate,
    { description: courseCode || "" }
  );

  // update event settings
  changeEventColor(event,courseTitle);
  changeLocation(event, courseTitle);
  event.setGuestsCanInviteOthers(false);
  event.setGuestsCanModify(false);
  event.setGuestsCanSeeGuests(false);

  return event.getId().split("@")[0];
}

function renameCreatedCourseDays(
  calendar,
  seriesEventId,
  fullCourseTitle,
  courseTime,
  startDate,
  endDate
) {

  var events = calendar.getEvents(startDate, endDate);
  var dayCounter = 0;

  for (var i = 0; i < events.length; i++) {
    var e = events[i];

    // 🔒 STRICT: only this series
    var thisSeriesId = e.getId().split("@")[0];
    if (thisSeriesId !== seriesEventId) continue;

    var timeRange = formatTimeRange(e.getStartTime(), e.getEndTime());
    if (timeRange !== courseTime) continue;

    dayCounter++;

    // Day 1 keeps original title
    if (dayCounter === 1) continue;
    
    e.setTitle("*Day " + dayCounter + " - " + fullCourseTitle);
  }

  Logger.log("✅ Renamed course days for series: " + seriesEventId);
}

function changeEventColor(event,courseTitle) {
  courseTitle = courseTitle.toLowerCase();
  console.log("inside the change event colour function");
  console.log("title extracted : ", courseTitle);
  if(courseTitle.includes("hydroponics")){
    console.log("event colour is set to gray as it is a external class");
    event.setColor(CalendarApp.EventColor.GRAY);
    //return event;
  } else {
    console.log("event colour is set to blue as it is a physical class");
    event.setColor(CalendarApp.EventColor.BLUE);
    //return event;
  }
}

// set mode of training for event
function changeLocation(event, courseTitle) {

  if (courseTitle.includes("Hydroponics")) {
    event.setLocation("Meod Farm, 13 Neo Tiew Harvest Ln, Singapore 719838");
  } else  {
    event.setLocation("12 Woodlands Square #07-85/86/87 Woods Square Tower 1, Singapore 737715 Map https://g.page/tertiarycourses-sg?share");
  }
}

function sendErrorEmail(emailSubject, errorHtml) { 
  // var email = 'tansc@tertiaryinfotech.com';
  // var ccEmailAddress = 'leepeng@tertiaryinfotech.com,sylvia@tertiaryinfotech.com,tanwm@tertiaryinfotech.com';
  var email = 'sylvia@tertiaryinfotech.com';
  var ccEmailAddress = "leepeng@tertiaryinfotech.com"

  // var email = 'guanhong01@hotmail.com'
  // var ccEmailAddress = "guanhong22222@gmail.com"

  var body = `
    <b>The Following Row(s) Could Not Be Created In Google Calendar By The Automation:</b><br><br>
    ${errorHtml}
    <br><br>
    Please Manually Create The Calendar Event And Add The Trainee using Their Email Address.
    <br>

    After Adding The Trainee, Please Tick The Checkbox Under The "Google Calendar" Column For That Row, Or Enter "TRUE" If The Column Is Not A Checkbox.
  `;

  GmailApp.sendEmail(email, emailSubject, '', {
    htmlBody: body,
    cc: ccEmailAddress,
    name: 'Tertiary Courses SG',
    from: 'sales@tertiarycourses.com.sg',
  });
}

function hashContent(text) {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      text,
      Utilities.Charset.UTF_8
    )
  );
}
