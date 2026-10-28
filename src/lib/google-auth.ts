const messages: Record<string, string> = {
  google_link_required:
    'Cette adresse possède déjà un compte. Connectez-vous par mail, puis associez Google dans les paramètres.',
  google_link_failed:
    'L’association a échoué. Utilisez le compte Google correspondant à l’adresse de votre compte CaRM et recommencez depuis les paramètres.',
  google_invalid_request:
    'Cette tentative de connexion a expiré ou a déjà été utilisée. Recommencez la connexion Google.',
  google_cancelled:
    'La connexion Google a été annulée. Vous pouvez réessayer ou utiliser votre adresse mail.',
  google_signin_failed:
    'La connexion Google a échoué. Vérifiez le compte choisi, notamment l’adresse indiquée sur votre invitation.',
};
export function googleAuthMessage(code: string | null) {
  return code ? (messages[code] ?? messages.google_signin_failed) : '';
}
