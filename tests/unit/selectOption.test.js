import { describe, expect, jest, test } from '@jest/globals';
import { selectOption } from '../../lib/select-option.js';

describe('selectOption', () => {
  test('prefers the visible option label', async () => {
    const locator = { evaluate: jest.fn().mockResolvedValue('label'), selectOption: jest.fn().mockResolvedValue(['out_of_stock']) };
    await expect(selectOption(locator, 'Out of Stock')).resolves.toEqual(['out_of_stock']);
    expect(locator.selectOption).toHaveBeenCalledWith({ label: 'Out of Stock' }, {timeout:5000});
  });

  test('falls back to the HTML value', async () => {
    const locator = {
      evaluate: jest.fn().mockResolvedValue('value'),
      selectOption: jest.fn().mockResolvedValue(['out_of_stock']),
    };
    await expect(selectOption(locator, 'out_of_stock')).resolves.toEqual(['out_of_stock']);
    expect(locator.selectOption).toHaveBeenCalledTimes(1);
    expect(locator.selectOption).toHaveBeenCalledWith({ value: 'out_of_stock' }, {timeout:5000});
  });
});
