package com.acme.shop.messaging;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {
    @KafkaListener(topics = "orders.cancelled")
    public void onCancelled(String orderId) {
        System.out.println("order cancelled " + orderId);
    }
}
