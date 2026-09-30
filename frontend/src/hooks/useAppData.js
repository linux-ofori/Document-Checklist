import { useContext } from 'react'
import { AppDataContext } from '../context/AppDataContext'

export function useAppData() {
  const context = useContext(AppDataContext)

  if (!context) {
    throw new Error('useAppData must be used inside an AppDataProvider.')
  }

  return context
}
