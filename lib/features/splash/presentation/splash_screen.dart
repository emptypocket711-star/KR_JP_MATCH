import 'package:flutter/material.dart';
import '../../../core/i18n/ui_text.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'Hana',
              style: Theme.of(context).textTheme.displayLarge,
            ),
            const SizedBox(height: 32),
            const CircularProgressIndicator(),
            const SizedBox(height: 24),
            Text(
              context.t('\uB85C\uB529 \uC911...',
                  '\u8AAD\u307F\u8FBC\u307F\u4E2D...'),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}
