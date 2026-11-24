// Catalog metadata from the owner-approved disabled installation receipt; no function bodies or credentials.
// Receipt SHA-256: 1808e7c139a801195fedd5ab5ed6c030a489e19f7c4c23f9dc0aa4884b98f9a8.
// Approved SQL SHA-256: c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e.
export const PHONE_CALLBACK_SCHEMA_ATTESTATIONS = Object.freeze([
    {
        "signature": "public.apply_phone_provider_event(uuid,text,text,text,text,text)",
        "ownerRole": "thaara_phone_callback_guard",
        "securityDefiner": true,
        "definitionSha256": "1acedd07bd1046e9fcdcbf4be78e6a2524fd409bfd791c7579e0140f90359a7f"
    },
    {
        "signature": "public.complete_phone_provider_report(uuid,text,text,text,text,jsonb)",
        "ownerRole": "thaara_phone_callback_guard",
        "securityDefiner": true,
        "definitionSha256": "b61f437d3ff4fe30f12384a6d53baa66e849fc40ae61e63920b71aaf7447bd7c"
    },
    {
        "signature": "public.phone_callback_inbound_save(jsonb,text)",
        "ownerRole": "thaara_phone_guard",
        "securityDefiner": true,
        "definitionSha256": "0d6fc0912a9ac2290f7db71cbdaa8aa5d0799dc41c1a34ce009a9fb9a81b2774"
    },
    {
        "signature": "public.phone_callback_outbound_context(uuid,text,text)",
        "ownerRole": "thaara_phone_callback_guard",
        "securityDefiner": true,
        "definitionSha256": "a2ef3dd4d59c9f5e6a83f45e4e2e4b57dd8d49bd446b938e60e2511ac28c78b6"
    },
    {
        "signature": "public.phone_callback_outbound_save(uuid,text,text,jsonb,text)",
        "ownerRole": "thaara_phone_callback_guard",
        "securityDefiner": true,
        "definitionSha256": "066fb817d1b490cce5b5d16f7b65a553a32f64c63cead5b5efde9a019d663a6e"
    },
    {
        "signature": "public.phone_callback_record_grant_use()",
        "ownerRole": "postgres",
        "securityDefiner": false,
        "definitionSha256": "789d6e458d906b53f39dfa1900d5f2f75de563287db5425741055ea63ef219b9"
    },
    {
        "signature": "public.phone_callback_validate_grant()",
        "ownerRole": "postgres",
        "securityDefiner": false,
        "definitionSha256": "467bf80d347bbe11516e5a92c887abbd204883da8e8710e31aa99d22245c590a"
    },
    {
        "signature": "public.phone_callback_worker_operation(text,uuid,uuid,text,text,uuid,text,text,uuid)",
        "ownerRole": "thaara_phone_notify_guard",
        "securityDefiner": true,
        "definitionSha256": "6ff72048b50b6ac9fa33212db0f82ebb7eaef069a7d1995c69e34958fe21522d"
    },
    {
        "signature": "public.phone_inbound_append_event(jsonb)",
        "ownerRole": "thaara_phone_guard",
        "securityDefiner": true,
        "definitionSha256": "07e10569a5c8a3be41c89c92e20b34e70236c807523cb2afa341d9c9f5283e15"
    },
    {
        "signature": "public.phone_inbound_resolve_grant(text,text,text)",
        "ownerRole": "thaara_phone_guard",
        "securityDefiner": true,
        "definitionSha256": "564d9425d4d1b38eea4a7cd6a66a582d74c7cf029daa939d09517dd75b51649e"
    },
    {
        "signature": "public.phone_inbound_scope_matches(uuid,uuid)",
        "ownerRole": "thaara_phone_guard",
        "securityDefiner": true,
        "definitionSha256": "ac307f0d1fb508313fd9049badb119972f4ba394c3704c9dee34390e42399e6a"
    },
    {
        "signature": "public.phone_provider_binding(uuid)",
        "ownerRole": "thaara_phone_callback_guard",
        "securityDefiner": true,
        "definitionSha256": "7965975316ecd47f3557c65605e220d3c54845b31294fe24589c5efe261ba793"
    }
].map(item => Object.freeze(item)));
