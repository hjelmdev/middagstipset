import assert from 'node:assert/strict';
import test from 'node:test';
import { validateState } from '../src/app/core/state.repository.ts';
import type { AppState, ParticipantPreset } from '../src/app/domain/models.ts';

function baseState(): AppState {
  return {
    version: 1,
    household: {
      id: 'home', name: 'Hemma', people: [
        { id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] },
        { id: 'child', name: 'Barn', portionFactor: 0.5, dietaryNeeds: [] },
      ],
    },
    plans: [], favoriteRecipeIds: [], shoppingItems: [],
  };
}

function preset(overrides: Partial<ParticipantPreset> = {}): ParticipantPreset {
  return { id: 'family', name: 'Familjen', participantIds: ['adult', 'child'], ...overrides };
}

test('validerar presets med befintliga deltagare och accepterar saknat valfritt fält', () => {
  const legacy = baseState();
  assert.deepEqual(validateState(legacy), legacy);
  const state = { ...legacy, participantPresets: [preset()] };
  assert.deepEqual(validateState(state), state);
});

test('avvisar presets utan deltagare, med okänd eller upprepad deltagare', () => {
  for (const candidate of [
    preset({ participantIds: [] }),
    preset({ participantIds: ['adult', 'missing'] }),
    preset({ participantIds: ['adult', 'adult'] }),
  ]) {
    assert.throws(() => validateState({ ...baseState(), participantPresets: [candidate] }), /sällskap/i);
  }
});

test('avvisar tomt eller för långt namn samt dubbla preset-id:n', () => {
  const duplicateId = preset({ name: 'Kopia' });
  const cases = [
    [preset({ name: '  ' })],
    [preset({ name: 'x'.repeat(81) })],
    [preset(), duplicateId],
  ];
  for (const participantPresets of cases) {
    assert.throws(() => validateState({ ...baseState(), participantPresets }), /sällskap/i);
  }
});
