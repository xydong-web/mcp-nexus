## ADDED Requirements

### Requirement: Grok key warning SHALL account for provider API key configuration
The admin Settings page SHALL show the "no active Grok keys" warning only when GrokSearch is enabled and neither key source is available for runtime use.

#### Scenario: GrokSearch enabled with no active Grok key and no provider API key
- **WHEN** GrokSearch is enabled and `grokActiveKeyCount` is `0` and provider API key is not configured
- **THEN** the warning badge about no active Grok keys is displayed.

#### Scenario: GrokSearch enabled with provider API key configured
- **WHEN** GrokSearch is enabled and `grokActiveKeyCount` is `0` but provider API key is configured
- **THEN** the warning badge about no active Grok keys is not displayed.
