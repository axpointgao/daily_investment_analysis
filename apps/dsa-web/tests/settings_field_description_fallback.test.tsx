import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsField } from '../src/components/settings/SettingsField';

describe('SettingsField description fallback', () => {
  it('does not show English schema.description when i18n map has no description for key', () => {
    const html = renderToStaticMarkup(
      <SettingsField
        item={{
          key: 'UNMAPPED_FALLBACK_FIELD',
          value: '1',
          rawValueExists: true,
          isMasked: false,
          schema: {
            key: 'UNMAPPED_FALLBACK_FIELD',
            title: 'Unmapped fallback field',
            description: 'schema fallback description',
            category: 'system',
            dataType: 'string',
            uiControl: 'text',
            isSensitive: false,
            isRequired: false,
            isEditable: true,
            defaultValue: null,
            options: [],
            validation: {},
            displayOrder: 9999,
          },
        }}
        value="1"
        onChange={() => undefined}
      />
    );

    expect(html).not.toContain('schema fallback description');
  });

  it('uses Chinese schema.description when i18n map has no description for key', () => {
    const html = renderToStaticMarkup(
      <SettingsField
        item={{
          key: 'UNMAPPED_FALLBACK_FIELD',
          value: '1',
          rawValueExists: true,
          isMasked: false,
          schema: {
            key: 'UNMAPPED_FALLBACK_FIELD',
            title: '未映射字段',
            description: '中文兜底说明',
            category: 'system',
            dataType: 'string',
            uiControl: 'text',
            isSensitive: false,
            isRequired: false,
            isEditable: true,
            defaultValue: null,
            options: [],
            validation: {},
            displayOrder: 9999,
          },
        }}
        value="1"
        onChange={() => undefined}
      />
    );

    expect(html).toContain('中文兜底说明');
  });
});
