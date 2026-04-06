/***************************************
 * REMOVE TRAINEE FOR CALENDAR
 * (Final Status = Cancelled)
 ***************************************/
function remove_trainee_for_calendar() {

  var calendarId = "sales@tertiarycourses.com.sg";
  var sheet = SpreadsheetApp.getActive().getSheetByName("SSG DA (Confirmed)");
  var data = sheet.getDataRange().getValues();
  var header = data[0];

  const colCourseTitle    = header.indexOf("Course Title");
  const colStartDate      = header.indexOf("Course Start Date");
  const colEndDate        = header.indexOf("Course End Date");
  const colCourseCode     = header.indexOf("Course Reference Number");
  const colTraineeEmail   = header.indexOf("Trainee Email");
  const colFinalStatus    = header.indexOf("Final Status");
  const colGoogleCalendar = header.indexOf("Google Calendar");

  for (var i = 1; i < data.length; i++) {

    var row = data[i];

    if (row[colFinalStatus] !== "Cancelled") continue;
    if (row[colGoogleCalendar] !== true) continue;

    var courseTitle  = row[colCourseTitle];
    var courseCode   = row[colCourseCode];
    var traineeEmail = row[colTraineeEmail];

    var startYYYYMMDD = String(row[colStartDate]);
    var endYYYYMMDD   = String(row[colEndDate]);

    Logger.log("====================================");
    Logger.log("Removing trainee from row " + (i + 1));
    Logger.log("Course: " + courseTitle);
    Logger.log("Dates: " + startYYYYMMDD + " → " + endYYYYMMDD);

    // ⏰ SAME TIME LOGIC AS ADD
    var startHour = 9, startMinute = 30, endHour = 18, endMinute = 30;

    var isEveningCourse =
      EVENING_COURSE_CODES.has(courseCode) &&
      startYYYYMMDD !== endYYYYMMDD;

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

    var startDate = toDate(startYYYYMMDD, startHour, startMinute);
    var endDate   = toDate(endYYYYMMDD, endHour, endMinute);

    // 🔍 FIRST CHECK
    var existingEvent = findExistingEvent(
      courseTitle,
      courseTime,
      startDate,
      endDate,
      calendarId
    );

    var eventId = null;

    if (existingEvent) {
      eventId = existingEvent.getId().split("@")[0];
    } else {
      // 🔍 SECOND CHECK (family coverage)
      eventId = findExistingEventByDateCoverage(
        courseTitle,
        courseTime,
        startDate,
        endDate,
        calendarId
      );
    }

    if (!eventId) {
      // Logger.log("⚠️ No event found — assuming trainee already removed");

      // ✅ UNTICK because trainee is effectively not in calendar
      // sheet.getRange(i + 1, colGoogleCalendar + 1).setValue(false);
      // Logger.log("📕 Google Calendar unticked for row " + (i + 1));

      Logger.log("📕 There Is An Chance That This Calendar Event Is Virtual Or External, Pls Check And Remove The Trainee Accordingly " + (i + 1));
      continue;
    }

    // 🗑 REMOVE ATTENDEE
    removeAttendeeFromEvent(eventId, traineeEmail, calendarId);

    // ✅ UNTICK AFTER SUCCESSFUL REMOVAL
    sheet.getRange(i + 1, colGoogleCalendar + 1).setValue(false);
    Logger.log("📕 Google Calendar unticked for row " + (i + 1));
  }

  Logger.log("🎉 Removal processing complete");
}

/***************************************
 * REMOVE ATTENDEE FROM EVENT (API-SAFE)
 ***************************************/
function removeAttendeeFromEvent(eventId, emailAddress, calendarId) {

  if (!eventId || !emailAddress) return;

  try {
    // 🔍 Fetch event via Calendar API
    var apiEvent = Calendar.Events.get(calendarId, eventId);
    var apiAttendees = apiEvent.attendees || [];

    if (apiAttendees.length === 0) {
      Logger.log("👥 No attendees found — nothing to remove");
      return;
    }

    // 🔍 Check if trainee exists
    var exists = apiAttendees.some(a =>
      a.email && a.email.toLowerCase() === emailAddress.toLowerCase()
    );

    if (!exists) {
      Logger.log("👤 Trainee not found in event — already removed: " + emailAddress);
      return;
    }

    // ❌ Remove trainee
    var updatedAttendees = apiAttendees
      .filter(a =>
        a.email &&
        a.email.toLowerCase() !== emailAddress.toLowerCase()
      )
      .map(a => ({ email: a.email }));

    Logger.log("🗑 Removing attendee from event: " + emailAddress + " " + eventId);

    Calendar.Events.patch(
      { attendees: updatedAttendees },
      calendarId,
      eventId,
      { sendUpdates: "all" }
    );

  } catch (err) {
    Logger.log("❌ Failed to remove attendee: " + err);
  }
}

