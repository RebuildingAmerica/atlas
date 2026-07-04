export function clearProvisioningDemoEnv(): void {
  delete process.env.ATLAS_DEMO_DATA;
  delete process.env.ATLAS_DEMO_FIRST_SAVED_VIEWS;
  delete process.env.ATLAS_DEMO_ORG_ID;
  delete process.env.ATLAS_DEMO_ORG_NAME;
  delete process.env.ATLAS_DEMO_ORG_SLUG;
  delete process.env.ATLAS_DEMO_PRODUCT;
  delete process.env.ATLAS_DEMO_USER_EMAIL;
  delete process.env.ATLAS_DEMO_USER_ID;
  delete process.env.ATLAS_DEMO_USER_NAME;
}
