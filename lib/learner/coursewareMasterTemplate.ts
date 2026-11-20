import { escapeCoursewareHtml } from './coursewareEmailTemplate';

export interface CoursewareBranding {
  companyName: string; teamName: string; logoUrl: string; websiteUrl: string;
  fundedPortalUrl: string; nonFundedPortalUrl: string; supportPhone: string; supportEmail: string;
  supportName?: string;
}
/** Produces tenant-owned content for the existing single subject/body fields. */
export function buildCoursewareMasterTemplate(branding: CoursewareBranding) {
  const b = Object.fromEntries(Object.entries(branding).map(([k, v]) => [k, escapeCoursewareHtml(String(v ?? ''))])) as unknown as CoursewareBranding;
  for (const key of ['logoUrl', 'websiteUrl', 'fundedPortalUrl', 'nonFundedPortalUrl'] as const) {
    if (new URL(branding[key]).protocol !== 'https:') throw new Error('Courseware branding URLs must use HTTPS.');
  }
  const p = 'font-size:12px;line-height:16px;margin:0;';
  const supportName = escapeCoursewareHtml(branding.supportName || `${branding.companyName} Support`);
  return {
    subject: '{EMAIL_PURPOSE} - {COURSE_NAME}',
    body: `<div style="color:#000;background:#F6F6F6;font-family:Verdana,Arial,Helvetica,sans-serif;font-size:12px;margin:0;padding:0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center" valign="top" style="padding:20px 0;">
<table role="presentation" bgcolor="#FFFFFF" cellspacing="0" cellpadding="10" border="0" width="100%" style="max-width:650px;border:1px solid #E0E0E0;">
<tr><td style="padding:0;"><a href="${b.websiteUrl}"><img src="${b.logoUrl}" alt="${b.companyName}" border="0" style="display:block;width:100%;max-width:650px;height:auto;margin:0 0 10px;"></a></td></tr>
<tr><td valign="top">
<h1 style="font-size:22px;font-weight:normal;line-height:22px;margin:0 0 11px;">Dear Learners,</h1>
<p style="${p}">Welcome to ${b.companyName}.</p>
<h1 style="font-size:16px;">Your Course Details</h1>
<p style="${p}">Course: {COURSE_NAME}<br>Course Code: {COURSE_CODE}<br>Course Run Code: {COURSE_RUN_CODE}<br>Date: {COURSE_DATES}</p>
<h1 style="font-size:16px;">Course Material and Login</h1>
<!-- cw:if UNRECOGNISED --><p style="${p}">Please check the Course Code shown above or on your registration and use the appropriate portal below:</p><!-- cw:end -->
<ul style="font-size:12px;line-height:16px;margin:10px 0;padding-left:20px;">
<!-- cw:if SHOW_FUNDED --><li><strong>WSQ&ndash;SWDA funded courses</strong> (course codes beginning with TGS-):<br><a href="${b.fundedPortalUrl}" style="overflow-wrap:anywhere;">${b.fundedPortalUrl}</a></li><!-- cw:end -->
<!-- cw:if SHOW_NON_FUNDED --><li><strong>Non-funded courses</strong> (course codes beginning with C, such as C-xxxx or C251):<br><a href="${b.nonFundedPortalUrl}" style="overflow-wrap:anywhere;">${b.nonFundedPortalUrl}</a></li><!-- cw:end -->
</ul>
<!-- cw:if UNRECOGNISED --><p style="${p}"><strong>If you are unsure which portal to use, please check with your trainer or contact ${supportName} using the details below.</strong><br><br></p><!-- cw:end -->
<p style="${p}">Sign in to the appropriate portal using your registered email address by requesting a one-time password (OTP). Once signed in, open your course to download the course materials.<br><br>
<!-- cw:if HAS_RUN_CODE -->If you are unable to sign in or cannot see the course you are attending, complete <strong>learner self-registration</strong> on the login page using the <strong>Course Run Code shown above</strong>.<!-- cw:end -->
<!-- cw:if NO_RUN_CODE -->If you are unable to sign in or cannot see your course, please ask your trainer or ${supportName} for your Course Run Code before completing learner self-registration on the login page.<!-- cw:end -->
<br><br><strong>Reminder:</strong> If your OTP does not arrive, please check your <strong>spam or junk folder</strong>.</p>
<!-- cw:if SHOW_NON_FUNDED --><h1 style="font-size:16px;">Class Attendance &mdash; Non-Funded Courses Only</h1>
<p style="${p}">If you are attending a non-funded course, please follow your trainer&rsquo;s instructions for recording your attendance during each class session.</p><!-- cw:end -->
<!-- cw:if SHOW_FUNDED --><h1 style="font-size:16px;">E-Attendance &mdash; SWDA-Funded Course</h1>
<p style="${p}">If you are attending a SWDA-funded course, please complete your digital e-attendance for each session
<!-- cw:if HAS_ATTENDANCE_LINK -->using the link below and follow your trainer&rsquo;s instructions.<br><br><a href="{E_ATTENDANCE_URL}">Take e-attendance</a><!-- cw:end -->
<!-- cw:if NO_ATTENDANCE_LINK -->using the attendance link provided by your trainer.<!-- cw:end --></p>
<h1 style="font-size:16px;">Assessment Submission &mdash; WSQ Courses Only</h1>
<p style="${p}"><!-- cw:if FUNDED -->Open<!-- cw:end --><!-- cw:if UNRECOGNISED -->If you are attending a WSQ course, open<!-- cw:end --> your class in the WSQ portal above and complete and submit your assessment according to your trainer&rsquo;s instructions and assessment schedule.</p><!-- cw:end -->
<h1 style="font-size:16px;">${supportName}</h1>
<p style="${p}">If you need assistance, please contact us:<br><br>Tel: ${b.supportPhone}<br>Email: <a href="mailto:${b.supportEmail}">${b.supportEmail}</a><br><br>Best regards,<br>${b.teamName}</p>
</td></tr></table></td></tr></table></div>`,
  };
}
