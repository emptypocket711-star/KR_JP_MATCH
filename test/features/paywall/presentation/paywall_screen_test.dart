import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hana/features/paywall/presentation/key_provider.dart';
import 'package:hana/features/paywall/presentation/low_key_sheet.dart';
import 'package:hana/features/paywall/presentation/paywall_screen.dart';

void main() {
  testWidgets(
    'disabled paywall has no price or reset claim and opens Lounge compose',
    (tester) async {
      final router = GoRouter(
        initialLocation: '/paywall',
        routes: [
          GoRoute(
            path: '/paywall',
            builder: (_, __) => const PaywallScreen(),
          ),
          GoRoute(
            path: '/lounge/compose',
            builder: (_, __) => const Scaffold(
              body: Text('라운지 글쓰기 화면'),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            keyCountProvider.overrideWith((ref) => Stream.value(2)),
          ],
          child: _LocalizedApp.router(router),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('2개'), findsOneWidget);
      expect(find.text('열쇠 구매는 현재 이용할 수 없어요'), findsOneWidget);
      expect(find.textContaining('오늘 아직 보상을 받지 않았다면'), findsOneWidget);
      expect(find.textContaining('₩'), findsNothing);
      expect(find.textContaining('무료 충전까지'), findsNothing);
      expect(find.textContaining('매일 3개 무료'), findsNothing);
      expect(find.textContaining('Google Play'), findsNothing);
      expect(find.textContaining('충전 패키지'), findsNothing);

      await tester.tap(find.text('라운지 글쓰기'));
      await tester.pumpAndSettle();

      expect(find.text('라운지 글쓰기 화면'), findsOneWidget);
    },
  );

  testWidgets('low-key entry does not promise an automatic reset or purchase',
      (tester) async {
    await tester.pumpWidget(
      const _LocalizedApp(
        home: Scaffold(body: LowKeySheet()),
      ),
    );

    expect(find.textContaining('오늘 아직 보상을 받지 않았다면'), findsOneWidget);
    expect(find.textContaining('자정'), findsNothing);
    expect(find.textContaining('충전하기'), findsNothing);
    expect(find.text('열쇠 받는 방법 보기'), findsOneWidget);
  });
}

class _LocalizedApp extends StatelessWidget {
  const _LocalizedApp({required this.home}) : router = null;

  const _LocalizedApp.router(this.router) : home = null;

  final Widget? home;
  final GoRouter? router;

  @override
  Widget build(BuildContext context) {
    if (router != null) {
      return MaterialApp.router(
        routerConfig: router,
        locale: const Locale('ko'),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale('ko'), Locale('ja')],
      );
    }
    return MaterialApp(
      locale: const Locale('ko'),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: const [Locale('ko'), Locale('ja')],
      home: home,
    );
  }
}
