import { COLORS } from '@/constants/color'
import { useRouter } from 'expo-router'
import React, { useRef, useState } from 'react'
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet
} from 'react-native'
import EmailStep from '../components/auth/emailStep'
import InitialStep from '../components/auth/initialStep'
import NameStep from '../components/auth/nameStep'
import PasswordStep from '../components/auth/passwordStep'
import QuestionnaireStep, { QuestionnaireStepHandle } from '../components/auth/questionnaireStep'
import ErrorDialog from '../components/ErrorDialog'
import { useAuth } from '../contexts/AuthContext'
import { computeFinancialScore } from '../lib/questionnaireScore'
import { clearOnboardingStep, clearQuestionnaireDraft, saveOnboardingStep, saveProficiencyLevel } from '../lib/questionnaireStorage'
import { supabase } from '../lib/supabase'

type QuestionnaireAnswers = Record<string, string | string[] | null>

export default function AuthScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { authStep, setAuthStep, beginOnboarding, finishOnboarding, startCelebration } = useAuth()
  const questionnaireRef = useRef<QuestionnaireStepHandle>(null)

  const step = authStep

  React.useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // return true to indicate we've handled the back button press (prevent default behavior)
      if (step === 'email') {
        setAuthStep('initial')
        return true
      }
      if (step === 'password') {
        setAuthStep('email')
        return true
      }
      if (step === 'name') {
        // Once on the name step we don't allow going back to password/email
        return true
      }
      if (step === 'questionnaire') {
        // If questionnaire step.current is defined, call its children goBack method
        questionnaireRef.current?.goBack()
        return true
      }
      return false
    })
    // Cleanup on unmount: when the component unmounts, remove the back handler
    return () => handler.remove()
  }, [step]) // Dependency only on step - setAuthStep doesn't need to be included

  const handleAuth = async (
    mode: 'signIn' | 'signUp',
    credentials?: { email: string; password: string }
  ) => {
    const emailToUse = credentials?.email ?? email
    const passwordToUse = credentials?.password ?? password

    if (!emailToUse || !passwordToUse) {
      setErrorMessage('Please enter email and password')
      return
    }

    setLoading(true)

    if (mode === 'signUp') {
      await clearQuestionnaireDraft()
      await clearOnboardingStep()
      await saveOnboardingStep('name')  
      beginOnboarding()
    }

    if (credentials) {
      setEmail(emailToUse)
      setPassword(passwordToUse)
    }

    const action =
      mode === 'signIn'
        ? supabase.auth.signInWithPassword({ email: emailToUse, password: passwordToUse })
        : supabase.auth.signUp({ email: emailToUse, password: passwordToUse })

    const { error } = await action

    if (error) {
      setErrorMessage(error.message)
      setLoading(false)
      return
    }

    if (mode === 'signIn') {
      setLoading(false)
      startCelebration()
      return
    }

    // Sign up succeeded
    setLoading(false)
    setAuthStep('name')
  }

  const handleQuestionnaireComplete = async (answers: QuestionnaireAnswers) => {
    try {
      setLoading(true)
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error('No authenticated user found')

      const { totalScore, proficiencyLevel } = computeFinancialScore(answers)

      const updates: Record<string, any> = {
        id: user.id,
        questionnaire_answers: answers,
        financial_score: totalScore,
        proficiency_level: proficiencyLevel,
        updated_at: new Date(),
      }

      if (name) {
        updates.full_name = name
      }

      const { error } = await supabase.from('profiles').upsert(updates)
      if (error) throw error

      await saveProficiencyLevel(proficiencyLevel)
      await clearQuestionnaireDraft()
      await clearOnboardingStep()
      finishOnboarding()
      startCelebration()
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Unable to save questionnaire answers.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      {step === 'questionnaire' ? (
        <QuestionnaireStep
          ref={questionnaireRef}
          onBack={() => setAuthStep('name')}
          onComplete={handleQuestionnaireComplete}
        />
      ) : (
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContent,
            (step === 'name' || step === 'email' || step === 'password') && styles.scrollContentCompact
          ]} 
          keyboardShouldPersistTaps="always"
        >
          {step === 'initial' && (
            <InitialStep
              onNext={() => setAuthStep('email')}
              onAccessExisting={async () => {
                await handleAuth('signIn', {
                  email: 'reviewer@reviewer.com',
                  password: '123456',
                })
              }}
              loading={loading}
            />
          )}

          {step === 'email' && (
            <EmailStep
              email={email}
              setEmail={setEmail}
              onNext={() => setAuthStep('password')}
              onBack={() => setAuthStep('initial')}
            />
          )}

          {step === 'password' && (
            <PasswordStep
              email={email}
              password={password}
              setPassword={setPassword}
              loading={loading}
              onBack={() => setAuthStep('email')}
              onSignIn={() => handleAuth('signIn')}
              onSignUp={() => handleAuth('signUp')}
            />
          )}

          {step === 'name' && (
            <NameStep
              name={name}
              setName={setName}
              onNext={async () => {
                setAuthStep('questionnaire')
                await saveOnboardingStep('questionnaire')
              }}
            />
          )}

          <ErrorDialog
            visible={!!errorMessage}
            message={errorMessage ?? ''}
            onClose={() => setErrorMessage(null)}
          />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    marginTop: '8%',
  },
  scrollContentCompact: {
    marginTop: '2%',
  },
})
