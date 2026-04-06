var CLIENT_ID = 'ABlNp7G4s0mj4EVJmUP8n8WdiJbbLjyyQcg3pWcD8AHqnCe0P1'; // From QuickBooks Developer Console (Production)
var CLIENT_SECRET = 'INecfMPPKBZ9D6fEsRwuM3mJg3AKoFfWyHBGHlmY'; // From QuickBooks Developer Console (Production)
var BASE_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
var TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
var API_SCOPE = 'com.intuit.quickbooks.accounting';
var REDIRECT_URI = 'https://script.google.com/macros/d/1WGxwrp_XNm9J2PA2LmgzbD04dXho99gKnAsWANUSyIwHdrZ-p-svPqMB/usercallback'; // Generate using the logRedirectUri() function mentioned at the end of this script
var RESPONSE_TYPE = 'code';
var COMPANY_ID = '1292117680';

/**
 * Authorizes and makes a request to the QuickBooks API using OAuth 2.
*/ 
function runAuth() {
  var service = getAuthService();
  if (service.hasAccess()) {
    var url = 'https://quickbooks.api.intuit.com/v3/company/1292117680/companyinfo/1292117680';
    var response = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: 'Bearer ' + service.getAccessToken(),
        Accept: 'application/json'
      }
    });
    var result = JSON.parse(response.getContentText());
    Logger.log(JSON.stringify(result, null, 2));
  } else {
    var authorizationUrl = service.getAuthorizationUrl();
    Logger.log('Open the following URL and re-run the script: %s', authorizationUrl);
  }
}

/**
 * Reset the authorization state, so that it can be re-tested.
*/ 
function reset() {
  getAuthService().reset();
  Logger.log('Authorization reset.');
}

/**
 * Configures the service.
 */
function getAuthService() {
  return OAuth2.createService('Quickbooks')
      .setAuthorizationBaseUrl(BASE_AUTH_URL)
      .setTokenUrl(TOKEN_URL)
      .setClientId(CLIENT_ID)
      .setClientSecret(CLIENT_SECRET)
      .setScope(API_SCOPE)
      .setCallbackFunction('authCallback')
      .setParam('response_type', RESPONSE_TYPE)
      .setParam('state', getStateToken('authCallback'))
      // .setPropertyStore(PropertiesService.getUserProperties()); // saves auth token to user-side only
      .setPropertyStore(PropertiesService.getScriptProperties()); // saves auth token to script-side, so all users can use it
}

/**
 * Handles the OAuth callback.
 */
function authCallback(request) {
  var service = getAuthService();
  var authorized = service.handleCallback(request);
  if (authorized) {
    Logger.log("Authorization successful!");
    return HtmlService.createHtmlOutput('Success!');
  } else {
    Logger.log("Authorization failed!");
    return HtmlService.createHtmlOutput('Authorization Denied.');
  }
}

/** 
 * Generate a State Token.
 */
function getStateToken(callbackFunction){
 var stateToken = ScriptApp.newStateToken()
     .withMethod(callbackFunction)
     .withTimeout(120)
     .createToken();
 return stateToken;
}

/**
 * Logs the redirect URI. Run this function to get the REDIRECT_URI to be mentioned at the top of this script. 
 */
function logRedirectUri() {
  Logger.log(getAuthService().getRedirectUri());
}