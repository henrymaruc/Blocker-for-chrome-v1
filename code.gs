const CHROME_POLICY_API = 'https://chromepolicy.googleapis.com/v1';
const INSTALL_TYPE_SCHEMA = 'chrome.users.apps.InstallType';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ChromeOS Extension Controller')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function validateInput_(form) {
  form = form || {};
  const customer = String(form.customerId || 'my_customer').trim();
  let ouId = String(form.orgUnitId || '').trim();
  ouId = ouId.replace(/^orgunits\//i, '');
  const extensionId = String(form.extensionId || '').trim().toLowerCase();

  if (!customer || !/^[A-Za-z0-9._:-]+$/.test(customer)) {
    throw new Error('Enter a valid Google Workspace customer ID, or use my_customer.');
  }
  if (!ouId || !/^[A-Za-z0-9_-]+$/.test(ouId)) {
    throw new Error('Enter the organizational unit ID from Google Admin Console.');
  }
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Extension ID must be exactly 32 letters, from a through p.');
  }
  return { customer: customer, ouId: ouId, extensionId: extensionId };
}

function policyTarget_(data) {
  return {
    targetResource: 'orgunits/' + data.ouId,
    additionalTargetKeys: { app_id: 'chrome:' + data.extensionId }
  };
}

function callPolicyApi_(customer, endpoint, method, payload) {
  const options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(
    CHROME_POLICY_API + '/customers/' + encodeURIComponent(customer) + endpoint,
    options
  );
  const status = response.getResponseCode();
  const text = response.getContentText();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
  }
  if (status < 200 || status >= 300) {
    const message = body && body.error && body.error.message
      ? body.error.message
      : (text || 'Unknown API error');
    throw new Error('Google API error (' + status + '): ' + message);
  }
  return body;
}

function setExtensionInstallType(form, installType) {
  const data = validateInput_(form);
  if (installType !== 'BLOCKED' && installType !== 'ALLOWED') {
    throw new Error('Unsupported action.');
  }

  callPolicyApi_(
    data.customer,
    '/policies/orgunits:batchModify',
    'post',
    {
      requests: [{
        policyTargetKey: policyTarget_(data),
        policyValue: {
          policySchema: INSTALL_TYPE_SCHEMA,
          value: { appInstallType: installType }
        },
        updateMask: { paths: 'appInstallType' }
      }]
    }
  );

  return installType === 'BLOCKED'
    ? 'Block policy saved for extension ' + data.extensionId + ' in OU ' + data.ouId + '.'
    : 'Allow policy saved for extension ' + data.extensionId + ' in OU ' + data.ouId + '.';
}

function blockExtension(form) {
  return setExtensionInstallType(form, 'BLOCKED');
}

function allowExtension(form) {
  return setExtensionInstallType(form, 'ALLOWED');
}

function clearExtensionOverride(form) {
  const data = validateInput_(form);
  callPolicyApi_(
    data.customer,
    '/policies/orgunits:batchInherit',
    'post',
    {
      requests: [{
        policyTargetKey: policyTarget_(data),
        policySchema: INSTALL_TYPE_SCHEMA
      }]
    }
  );
  return 'The InstallType override was removed for ' + data.extensionId + '. The extension now inherits the parent OU policy, if one exists.';
}

function getExtensionStatus(form) {
  const data = validateInput_(form);
  const result = callPolicyApi_(
    data.customer,
    '/policies:resolve',
    'post',
    {
      policySchemaFilter: INSTALL_TYPE_SCHEMA,
      policyTargetKey: policyTarget_(data),
      pageSize: 10
    }
  );

  const policies = result.resolvedPolicies || [];
  if (!policies.length) {
    return {
      status: 'No resolved InstallType policy was returned for this extension.',
      source: 'No policy source reported'
    };
  }

  const item = policies[0];
  const installType = item.value && item.value.value
    ? item.value.value.appInstallType
    : 'Unknown';
  const source = item.sourceKey && item.sourceKey.targetResource
    ? item.sourceKey.targetResource
    : 'Default / inherited';
  return { status: 'Current policy: ' + installType, source: 'Policy source: ' + source };
}
