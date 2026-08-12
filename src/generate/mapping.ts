/**
 * The ONE curated table: MCP tool name → CLI command path. The surface parity
 * test fails the build when this table and the server's tools/list diverge in
 * either direction, so adding a tool upstream forces a mapping decision here.
 *
 * `scribe call <tool_name>` reaches any tool by its exact MCP name regardless
 * of this table.
 */

/** MCP-only compatibility aliases for stale cached tool lists — no CLI command. */
export const EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  "get_analytics_overview",
  "get_analytics_breakdown",
]);

export const TOOL_COMMAND_MAP: Readonly<Record<string, readonly string[]>> = {
  // Signatures
  list_signatures: ["signatures", "list"],
  create_signature: ["signatures", "create"],
  update_signature: ["signatures", "update"],
  delete_signature: ["signatures", "delete"],
  publish_signature: ["signatures", "publish"],
  install_signature: ["signatures", "install"],
  preview_signature: ["signatures", "preview"],
  get_signature_html: ["signatures", "html"],
  list_signature_installations: ["signatures", "installations"],

  // Signature reply/internal variants
  list_signature_variants: ["signatures", "variants", "list"],
  update_signature_variant: ["signatures", "variants", "update"],
  publish_signature_variant: ["signatures", "variants", "publish"],
  delete_signature_variant: ["signatures", "variants", "delete"],

  // Signature recipients / targeting
  list_signature_recipients: ["signatures", "recipients", "list"],
  add_signature_recipients: ["signatures", "recipients", "add"],
  remove_signature_recipients: ["signatures", "recipients", "remove"],
  set_signature_recipient_rules: ["signatures", "recipients", "set-rules"],
  add_signature_recipient_entities: ["signatures", "recipients", "add-entities"],
  remove_signature_recipient_entities: ["signatures", "recipients", "remove-entities"],

  // Teammates
  list_teammates: ["teammates", "list"],
  create_teammate: ["teammates", "create"],
  update_teammate: ["teammates", "update"],
  delete_teammate: ["teammates", "delete"],

  // Emails
  list_emails: ["emails", "list"],
  create_email: ["emails", "create"],
  update_email: ["emails", "update"],
  delete_email: ["emails", "delete"],

  // Smart fields
  list_smart_fields: ["smart-fields", "list"],
  create_smart_field: ["smart-fields", "create"],
  update_smart_field: ["smart-fields", "update"],
  delete_smart_field: ["smart-fields", "delete"],

  // Folders
  list_folders: ["folders", "list"],
  create_folder: ["folders", "create"],
  update_folder: ["folders", "update"],
  delete_folder: ["folders", "delete"],

  // Assets
  list_assets: ["assets", "list"],
  create_asset: ["assets", "create"],
  update_asset: ["assets", "update"],
  delete_asset: ["assets", "delete"],

  // Marketing campaigns
  list_marketing_campaigns: ["campaigns", "list"],
  create_marketing_campaign: ["campaigns", "create"],
  update_marketing_campaign: ["campaigns", "update"],
  delete_marketing_campaign: ["campaigns", "delete"],
  preview_marketing_campaign: ["campaigns", "preview"],
  schedule_marketing_campaign: ["campaigns", "schedule"],
  pause_marketing_campaign: ["campaigns", "pause"],
  resume_marketing_campaign: ["campaigns", "resume"],

  // Analytics
  get_analytics_views: ["analytics", "views"],
  get_analytics_clicks: ["analytics", "clicks"],
  list_analytics_events: ["analytics", "events"],
  get_analytics_events_summary: ["analytics", "events-summary"],

  // Visitors
  list_visitors: ["visitors", "list"],
  get_visitor: ["visitors", "get"],
  get_visitor_breakdown: ["visitors", "breakdown"],

  // Integrations
  list_integrations: ["integrations", "list"],
  list_integration_entities: ["integrations", "entities"],

  // Workspace / billing / schema / docs / feedback
  get_workspace: ["workspace"],
  list_financial_documents: ["billing", "documents"],
  get_content_schema: ["content-schema"],
  search_docs: ["docs", "search"],
  read_docs_page: ["docs", "read"],
  send_feedback: ["feedback"],
};

/** Tools that work without Scribe credentials (public docs endpoints). */
export const NO_AUTH_TOOLS: ReadonlySet<string> = new Set(["search_docs", "read_docs_page"]);
