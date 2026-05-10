import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hana/gen_l10n/app_localizations.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';
import 'providers/font_size_provider.dart';
import 'providers/app_locale_provider.dart';
import 'providers/user_presence_provider.dart';

class HanaApp extends ConsumerWidget {
  const HanaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final fontPreset = ref.watch(fontSizeProvider);
    final locale = ref.watch(appLocaleProvider).value ?? const Locale('ko');
    ref.watch(userPresenceProvider);

    return MaterialApp.router(
      title: 'Hana',
      theme: AppTheme.lightTheme(),
      themeMode: ThemeMode.light,
      locale: locale,
      routerConfig: router,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(fontPreset.scale),
        ),
        child: child!,
      ),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('ko'), Locale('ja')],
    );
  }
}
