import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import Animated, { FadeIn, FadeInRight, LinearTransition, ReduceMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PlayerAvatar } from '@/components/avatar'
import { BrandEmblem } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { AppText, Button, Card, CardHeader, Chip, Field, Grid, IconButton, Input, Notice, Screen, ScreenHeader, Stack } from '@/components/ui'
import { formatCurrency } from '@/domain/format'
import type { AbsencePenaltyMode, ThemeId } from '@/domain/types'
import { parseEuroToCents } from '@/domain/utils'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { markOnboardingSkipped } from '@/hooks/use-onboarding'
import { useRuntime } from '@/providers/runtime-provider'
import { Feedback } from '@/services/haptics'
import { SessionService } from '@/services/session-service'
import { THEMES, colors, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

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
  const insets = useSafeAreaInsets()
  const { pagePadding, isTablet } = useDeviceLayout()
  const { t } = useTheme()

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
      // Completing counts like skipping: never force the assistant again,
      // even if the regulars are added (or archived) later.
      void markOnboardingSkipped()
      leave()
    } catch (caught) {
      Feedback.error()
      setError(caught instanceof Error ? caught.message : 'Einrichtung konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  async function skip() {
    await markOnboardingSkipped()
    leave()
  }

  /** Opened from the dashboard → go back; started on launch → enter the tabs. */
  function leave() {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)')
  }

  const footer = (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.xs,
        paddingHorizontal: pagePadding,
        paddingTop: spacing.sm,
        paddingBottom: isTablet ? spacing.sm : Math.max(insets.bottom, spacing.sm),
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.tabBar,
      }}
    >
      <View style={{ flex: 1, maxWidth: 360 }}>
        {index > 0 ? (
          <Button tone="secondary" icon="arrow-back" onPress={() => setStep(STEPS[index - 1].id)}>Zurück</Button>
        ) : (
          <Button tone="secondary" onPress={skip}>Später einrichten</Button>
        )}
      </View>
      <View style={{ flex: 1.4 }}>
        <Button
          onPress={next}
          disabled={!actor}
          loading={saving}
          iconRight={isLast ? 'checkmark' : 'arrow-forward'}
        >
          {isLast ? "Fertig – los geht's" : 'Weiter'}
        </Button>
      </View>
    </View>
  )

  return (
    <Screen maxWidth={880} footer={footer}>
      <ScreenHeader
        leading={<BrandEmblem size={40} themeId={runtime.themeId} />}
        title="Willkommen"
        context={`In vier Schritten startklar · Schritt ${index + 1} von ${STEPS.length}`}
        actions={<Button tone="ghost" size="sm" onPress={skip}>Überspringen</Button>}
      />

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {STEPS.map((item, itemIndex) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Schritt ${itemIndex + 1}: ${item.label}`}
            accessibilityState={{ selected: itemIndex === index, disabled: itemIndex >= index }}
            onPress={() => { if (itemIndex < index) setStep(item.id) }}
            style={{ flex: 1, gap: 6 }}
          >
            <Animated.View
              layout={LinearTransition.duration(200)}
              style={{ height: 4, borderRadius: radius.pill, backgroundColor: itemIndex <= index ? colors.accent : colors.surfaceSoft }}
            />
            <AppText variant="caption" tone={itemIndex === index ? 'default' : 'subtle'} numberOfLines={1}>{item.label}</AppText>
          </Pressable>
        ))}
      </View>

      {error ? <Notice type="error" message={error} /> : null}

      <Animated.View key={step} entering={FadeInRight.duration(240).reduceMotion(ReduceMotion.System)}>
        {step === 'players' ? (
          <Card>
            <CardHeader overline="Schritt 1" title="Wer gehört zur Stammrunde?" icon="people-outline" />
            <AppText tone="muted">
              Stammspieler werden bei jedem neuen Abend automatisch geladen. Gäste kannst du später spontan hinzufügen.
            </AppText>
            <Field label="Name (mehrere mit Komma trennen)">
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Input
                    ref={inputRef}
                    value={nameInput}
                    onChangeText={setNameInput}
                    placeholder="z. B. Anna, Ben, Cem"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={addNames}
                  />
                </View>
                <IconButton icon="add" tone="primary" size={48} accessibilityLabel="Spieler hinzufügen" disabled={!nameInput.trim()} onPress={addNames} />
              </View>
            </Field>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {existingCore.map((name) => (
                <Chip key={`existing-${name}`} label={name} icon="checkmark" disabled leading={<PlayerAvatar id={name} name={name} size={30} />} />
              ))}
              {names.map((name) => (
                <Animated.View key={name} entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${name} entfernen`}
                    onPress={() => setNames((previous) => previous.filter((item) => item !== name))}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40,
                      borderRadius: radius.pill, paddingLeft: 4, paddingRight: spacing.sm,
                      backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent,
                    }}
                  >
                    <PlayerAvatar id={name} name={name} size={30} />
                    <AppText variant="label">{name}</AppText>
                    <Ionicons name="close" size={14} color={colors.muted} />
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
            {names.length + existingCore.length === 0 ? (
              <AppText variant="caption" tone="subtle">Du kannst Spieler auch später unter „Setup“ anlegen.</AppText>
            ) : null}
          </Card>
        ) : null}

        {step === 'stake' ? (
          <Card>
            <CardHeader overline="Schritt 2" title="Standard-Einsatz" icon="cash-outline" />
            <AppText tone="muted">So viel kostet ein verlorenes Spiel. Pro Abend lässt sich der Einsatz anpassen.</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'center', width: '100%', maxWidth: 420 }}>
              <IconButton icon="remove" size={56} accessibilityLabel="Einsatz verringern" onPress={() => adjustStake(-50)} />
              <View style={{ flex: 1 }}>
                <Input value={stake} onChangeText={setStake} keyboardType="decimal-pad" style={[t.numericLg, { textAlign: 'center', minHeight: 64 }]} />
              </View>
              <IconButton icon="add" size={56} accessibilityLabel="Einsatz erhöhen" onPress={() => adjustStake(50)} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' }}>
              {[50, 100, 200].map((cents) => (
                <Chip key={cents} label={formatCurrency(cents)} selected={stake === centsToInput(cents)} onPress={() => { Feedback.tap(); setStake(centsToInput(cents)) }} />
              ))}
            </View>
          </Card>
        ) : null}

        {step === 'absence' ? (
          <Card>
            <CardHeader overline="Schritt 3" title="Wer fehlt, zahlt?" icon="person-remove-outline" />
            <AppText tone="muted">Beim Abschluss eines Abends werden abwesende Stammspieler nach dieser Regel belastet.</AppText>
            <Stack gap={spacing.xs}>
              {ABSENCE_OPTIONS.map((option) => (
                <OptionCard key={option.id} selected={mode === option.id} title={option.title} description={option.description} onPress={() => { Feedback.tap(); setMode(option.id) }} />
              ))}
            </Stack>
          </Card>
        ) : null}

        {step === 'theme' ? (
          <Card>
            <CardHeader overline="Schritt 4" title="Euer Look" icon="color-palette-outline" />
            <Grid columns={{ compact: 1, medium: 3, expanded: 3 }}>
              {THEME_ORDER.map((themeId) => {
                const theme = THEMES[themeId]
                const selected = runtime.themeId === themeId
                return (
                  <PressableScale
                    key={themeId}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={theme.label}
                    onPress={() => { Feedback.tap(); runtime.setTheme(themeId) }}
                    style={{
                      borderRadius: radius.lg, padding: spacing.sm, gap: spacing.sm,
                      backgroundColor: theme.bgElevated, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.accent : theme.borderStrong,
                    }}
                  >
                    <View style={{ height: 56, borderRadius: radius.md, backgroundColor: theme.bg, padding: spacing.xs, flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
                      <View style={{ flex: 1, height: 22, borderRadius: radius.xs, backgroundColor: theme.surface }} />
                      <View style={{ flex: 1, height: 34, borderRadius: radius.xs, backgroundColor: theme.surfaceSoft }} />
                      <View style={{ flex: 1, height: 40, borderRadius: radius.xs, backgroundColor: theme.accent }} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <AppText variant="label" numberOfLines={1} style={{ flex: 1, color: theme.text }}>{theme.label}</AppText>
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? theme.accent : theme.subtle} />
                    </View>
                  </PressableScale>
                )
              })}
            </Grid>
          </Card>
        ) : null}
      </Animated.View>
    </Screen>
  )
}

function OptionCard({ selected, title, description, onPress }: { selected: boolean; title: string; description: string; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.985}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
        borderRadius: radius.md, padding: spacing.sm,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        borderWidth: 1, borderColor: selected ? colors.accent : colors.border,
      }}
    >
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.accentStrong : colors.subtle} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" tone="muted">{description}</AppText>
      </View>
    </PressableScale>
  )
}
