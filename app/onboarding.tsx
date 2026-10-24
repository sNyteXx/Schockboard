import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import Animated, { FadeIn, FadeInRight, LinearTransition } from 'react-native-reanimated'

import { BrandEmblem } from '@/components/brand'
import { Button, Card, Field, Input, Notice, Screen, SectionTitle, Split, Stack } from '@/components/ui'
import { formatCurrency } from '@/domain/format'
import type { AbsencePenaltyMode, ThemeId } from '@/domain/types'
import { parseEuroToCents } from '@/domain/utils'
import { markOnboardingSkipped } from '@/hooks/use-onboarding'
import { useRuntime } from '@/providers/runtime-provider'
import { Feedback } from '@/services/haptics'
import { SessionService } from '@/services/session-service'
import { THEMES, colors, radius, spacing } from '@/theme/tokens'

type OnboardingStep = 'players' | 'stake' | 'absence' | 'theme'
const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: 'players', label: 'Stammspieler' },
  { id: 'stake', label: 'Einsatz' },
  { id: 'absence', label: 'Abwesenheit' },
  { id: 'theme', label: 'Look' },
]

const ABSENCE_OPTIONS: Array<{ id: AbsencePenaltyMode; title: string; description: string }> = [
  { id: 'full_average', title: 'Voller Durchschnitt', description: 'Wer fehlt, zahlt so viel wie ein Anwesender im Schnitt verloren hat.' },
  { id: 'split_absent', title: 'Durchschnitt teilen', description: 'Alle Abwesenden teilen sich einen Durchschnittsbetrag.' },
  { id: 'none', title: 'Kein Zuschlag', description: 'Fehlen kostet nichts.' },
]

const THEME_ORDER: ThemeId[] = ['bvb09', 'original', 'midnight']

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

export default function OnboardingScreen() {
  const router = useRouter()
  const runtime = useRuntime()
  const settings = useMemo(() => SessionService.getSettings(), [])
  const existingCore = useMemo(
    () => SessionService.listPlayers().filter((player) => player.isCore && !player.isArchived).map((player) => player.name),
    [],
  )
  const [step, setStep] = useState<OnboardingStep>('players')
  const [names, setNames] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const [stake, setStake] = useState(centsToInput(settings.defaultStakeCents))
  const [mode, setMode] = useState<AbsencePenaltyMode>(settings.absencePenaltyMode)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<TextInput>(null)

  const index = STEPS.findIndex((item) => item.id === step)
  const isLast = index === STEPS.length - 1
  const actor = runtime.account ? { accountId: runtime.account.id, username: runtime.account.username } : null
  const known = new Set([...existingCore, ...names].map((name) => name.toLocaleLowerCase('de')))

  function addNames() {
    // Comma or line separated input adds several players at once.
    const parts = nameInput.split(/[,\n;]/).map((part) => part.trim()).filter(Boolean)
    const fresh: string[] = []
    for (const part of parts) {
      const key = part.toLocaleLowerCase('de')
      if (!known.has(key)) {
        known.add(key)
        fresh.push(part)
      }
    }
    if (fresh.length) {
      Feedback.tap()
      setNames((previous) => [...previous, ...fresh])
    }
    setNameInput('')
    inputRef.current?.focus()
  }

  function adjustStake(delta: number) {
    let current = settings.defaultStakeCents
    try {
      current = parseEuroToCents(stake)
    } catch {
      // keep default
    }
    setStake(centsToInput(Math.max(10, current + delta)))
    Feedback.tap()
  }

  function next() {
    setError(null)
    if (step === 'players' && nameInput.trim()) addNames()
    if (step === 'stake') {
      try {
        parseEuroToCents(stake)
      } catch {
        setError('Bitte einen gültigen Einsatz eingeben, z. B. 1,00.')
        Feedback.error()
        return
      }
    }
    if (isLast) {
      finish()
      return
    }
    Feedback.tap()
    setStep(STEPS[index + 1].id)
  }

  function finish() {
    if (!actor) return
    try {
      setSaving(true)
      const pending = names
      for (const name of pending) SessionService.createCorePlayer({ actor, name })
      SessionService.updateAppSettings({
        actor,
        defaultStakeCents: parseEuroToCents(stake),
        cashboxLabel: settings.cashboxLabel,
        absencePenaltyMode: mode,
      })
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message: pending.length ? `${pending.length} Stammspieler angelegt – viel Glück beim ersten Abend!` : 'Einstellungen gespeichert.',
      })
      Feedback.success()
      router.replace('/(tabs)')
    } catch (caught) {
      Feedback.error()
      setError(caught instanceof Error ? caught.message : 'Einrichtung konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  async function skip() {
    await markOnboardingSkipped()
    router.replace('/(tabs)')
  }

  return (
    <Screen>
      <Stack>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <BrandEmblem size={56} themeId={runtime.themeId} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '900', letterSpacing: 2.2 }}>WILLKOMMEN BEIM SCHOCKBOARD</Text>
            <Text style={{ color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.6 }}>In vier Schritten startklar</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={skip} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: spacing.xs })}>
            <Text style={{ color: colors.muted, fontWeight: '800' }}>Überspringen</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 6 }}>
          {STEPS.map((item, itemIndex) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Schritt ${itemIndex + 1}: ${item.label}`}
              onPress={() => { if (itemIndex < index) setStep(item.id) }}
              style={{ flex: 1, gap: 6 }}
            >
              <Animated.View
                layout={LinearTransition}
                style={{ height: 5, borderRadius: 3, backgroundColor: itemIndex <= index ? colors.accent : colors.surfaceSoft }}
              />
              <Text style={{ color: itemIndex === index ? colors.text : colors.muted, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Notice type="error" message={error} /> : null}

        <Animated.View key={step} entering={FadeInRight.duration(240)}>
          {step === 'players' ? (
            <Card>
              <SectionTitle eyebrow="Schritt 1" title="Wer gehört zur Stammrunde?" />
              <Text style={{ color: colors.muted, lineHeight: 21 }}>
                Stammspieler werden bei jedem neuen Abend automatisch geladen. Gäste kannst du später spontan hinzufügen.
              </Text>
              <Field label="Name (mehrere mit Komma trennen)">
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Input
                    ref={inputRef}
                    value={nameInput}
                    onChangeText={setNameInput}
                    placeholder="z. B. Anna, Ben, Cem"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={addNames}
                    style={{ flex: 1 }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Spieler hinzufügen"
                    disabled={!nameInput.trim()}
                    onPress={addNames}
                    style={({ pressed }) => ({
                      width: 52, borderRadius: radius.sm, backgroundColor: colors.accent,
                      alignItems: 'center', justifyContent: 'center', opacity: !nameInput.trim() ? 0.4 : pressed ? 0.75 : 1,
                    })}
                  >
                    <Ionicons name="add" size={26} color={colors.buttonPrimaryText} />
                  </Pressable>
                </View>
              </Field>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {existingCore.map((name) => (
                  <View key={`existing-${name}`} style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.muted, fontWeight: '700' }}>✓ {name}</Text>
                  </View>
                ))}
                {names.map((name) => (
                  <Animated.View key={name} entering={FadeIn.duration(180)}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${name} entfernen`}
                      onPress={() => setNames((previous) => previous.filter((item) => item !== name))}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 8,
                        backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.accent, opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800' }}>{name}</Text>
                      <Ionicons name="close" size={14} color={colors.muted} />
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
              {names.length + existingCore.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>Du kannst Spieler auch später unter „Setup“ anlegen.</Text>
              ) : null}
            </Card>
          ) : null}

          {step === 'stake' ? (
            <Card>
              <SectionTitle eyebrow="Schritt 2" title="Standard-Einsatz" />
              <Text style={{ color: colors.muted, lineHeight: 21 }}>So viel kostet ein verlorenes Spiel. Pro Abend lässt sich der Einsatz anpassen.</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <StepButton label="−" onPress={() => adjustStake(-50)} />
                <Input value={stake} onChangeText={setStake} keyboardType="decimal-pad" style={{ flex: 1, textAlign: 'center', fontSize: 24, fontWeight: '900' }} />
                <StepButton label="＋" onPress={() => adjustStake(50)} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                {[50, 100, 200].map((cents) => (
                  <Pressable
                    key={cents}
                    onPress={() => setStake(centsToInput(cents))}
                    style={({ pressed }) => ({ paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{formatCurrency(cents)}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          ) : null}

          {step === 'absence' ? (
            <Card>
              <SectionTitle eyebrow="Schritt 3" title="Wer fehlt, zahlt?" />
              <Text style={{ color: colors.muted, lineHeight: 21 }}>Beim Abschluss eines Abends werden abwesende Stammspieler nach dieser Regel belastet.</Text>
              <Stack>
                {ABSENCE_OPTIONS.map((option) => (
                  <OptionCard key={option.id} selected={mode === option.id} title={option.title} description={option.description} onPress={() => { Feedback.tap(); setMode(option.id) }} />
                ))}
              </Stack>
            </Card>
          ) : null}

          {step === 'theme' ? (
            <Card>
              <SectionTitle eyebrow="Schritt 4" title="Euer Look" />
              <Split>
                {THEME_ORDER.map((themeId) => {
                  const theme = THEMES[themeId]
                  const selected = runtime.themeId === themeId
                  return (
                    <Pressable
                      key={themeId}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => { Feedback.tap(); runtime.setTheme(themeId) }}
                      style={({ pressed }) => ({
                        borderRadius: radius.md, padding: spacing.md, gap: spacing.sm,
                        backgroundColor: theme.bgElevated, borderWidth: 2, borderColor: selected ? theme.accent : theme.border,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {[theme.bg, theme.surface, theme.accent, theme.text].map((swatch, swatchIndex) => (
                          <View key={swatchIndex} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: swatch, borderWidth: 1, borderColor: theme.border }} />
                        ))}
                      </View>
                      <Text style={{ color: theme.text, fontWeight: '900', fontSize: 16 }}>{theme.label}</Text>
                      {selected ? <Text style={{ color: theme.accentStrong, fontWeight: '800', fontSize: 12 }}>✓ AUSGEWÄHLT</Text> : null}
                    </Pressable>
                  )
                })}
              </Split>
            </Card>
          ) : null}
        </Animated.View>

        <Split>
          {index > 0 ? (
            <Button tone="secondary" onPress={() => setStep(STEPS[index - 1].id)}>← Zurück</Button>
          ) : (
            <Button tone="secondary" onPress={skip}>Später einrichten</Button>
          )}
          <Button onPress={next} disabled={saving || !actor}>{isLast ? (saving ? 'Speichere…' : "Fertig – los geht's") : 'Weiter →'}</Button>
        </Split>
      </Stack>
    </Screen>
  )
}

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52, height: 52, borderRadius: radius.pill,
        backgroundColor: pressed ? colors.accent : colors.surfaceSoft, borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      })}
    >
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.accentStrong }}>{label}</Text>
    </Pressable>
  )
}

function OptionCard({ selected, title, description, onPress }: { selected: boolean; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        borderRadius: radius.md, padding: spacing.md,
        backgroundColor: selected ? colors.surfaceSoft : colors.surface,
        borderWidth: 1, borderColor: selected ? colors.accent : colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.accentStrong : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '900' }}>{title}</Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>{description}</Text>
      </View>
    </Pressable>
  )
}
