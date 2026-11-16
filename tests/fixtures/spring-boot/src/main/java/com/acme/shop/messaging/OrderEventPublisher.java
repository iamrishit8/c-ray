package com.acme.shop.messaging;

import com.acme.shop.model.Order;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class OrderEventPublisher {
    private final KafkaTemplate<String, String> kafkaTemplate;

    public OrderEventPublisher(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void orderPlaced(Order order) {
        kafkaTemplate.send("orders.placed", String.valueOf(order.getId()));
    }
}
