import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/app/bootstrap/hana_bootstrap_app.dart';

void main() {
  test('App Check attestation gates the real application bootstrap', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final source = File(
      'lib/app/bootstrap/hana_bootstrap_app.dart',
    ).readAsStringSync();

    expect(mainSource, contains('HanaBootstrapApp'));
    final activateIndex = source.indexOf('FirebaseAppCheck.instance.activate');
    final tokenIndex = source.indexOf('FirebaseAppCheck.instance.getToken()');
    final appIndex = source.indexOf('ProviderScope(child: HanaApp())');
    expect(activateIndex, greaterThanOrEqualTo(0));
    expect(tokenIndex, greaterThan(activateIndex));
    expect(appIndex, greaterThan(tokenIndex));
    expect(source, isNot(contains('App Check 초기화 실패해도 앱은 계속 실행')));
    expect(source, contains('보안 연결을 확인하지 못했어요.'));
    expect(source, contains('FilledButton(onPressed: _retry'));
  });

  testWidgets('bootstrap failure never renders the core application', (
    tester,
  ) async {
    final attempts = <Completer<void>>[];
    await tester.pumpWidget(
      HanaBootstrapApp(
        bootstrapOverride: () {
          final attempt = Completer<void>();
          attempts.add(attempt);
          return attempt.future;
        },
        applicationOverride: const MaterialApp(home: Text('CORE APP')),
      ),
    );
    await tester.pump(const Duration(milliseconds: 1));
    expect(attempts, hasLength(1));
    attempts.single.completeError(StateError('attestation failed'));
    await tester.pumpAndSettle();

    expect(find.text('CORE APP'), findsNothing);
    expect(find.text('보안 연결을 확인하지 못했어요.'), findsOneWidget);

    await tester.tap(find.text('다시 시도'));
    await tester.pump(const Duration(milliseconds: 1));
    expect(attempts, hasLength(2));
    attempts.last.completeError(StateError('attestation failed again'));
    await tester.pumpAndSettle();
    expect(find.text('CORE APP'), findsNothing);
  });
}
