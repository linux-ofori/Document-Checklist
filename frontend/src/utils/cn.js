export function cn(...values) {
  const classes = []

  for (const value of values) {
    if (!value) continue

    if (typeof value === 'string' || typeof value === 'number') {
      classes.push(String(value))
    } else if (Array.isArray(value)) {
      const nested = cn(...value)
      if (nested) classes.push(nested)
    } else if (typeof value === 'object') {
      for (const [key, isActive] of Object.entries(value)) {
        if (isActive) classes.push(key)
      }
    }
  }

  return classes.join(' ')
}